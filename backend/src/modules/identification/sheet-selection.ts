import { createHash } from "node:crypto";
import { canonicalJson } from "../documents/canonical-json.js";
import {
  IdentificationContractError,
  isIdentificationDate,
  validateSheetMap,
  validateSheetReplacement,
  type IdentificationDocument,
  type IdentificationRevision,
  type ResolvedSheetSet,
} from "./identification-contract.js";

const hash = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");
const identity = (value: string | undefined) =>
  (value ?? "")
    .trim()
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ru-RU");

export function predecessorId(revision: IdentificationRevision): string | null {
  return (
    revision.sheet_replacement?.predecessor_revision_id ??
    revision.approval.replaces_revision_id
  );
}

/** Validate against immutable server-side representations, never client page counts. */
export function validateRevisionSheetMap(
  revision: IdentificationRevision,
): void {
  if (!revision.sheet_map) {
    if (revision.sheet_replacement)
      throw new IdentificationContractError("sheet_map_required");
    return;
  }
  const map = validateSheetMap(revision.sheet_map);
  const representation = revision.representations[0];
  if (
    revision.representations.length !== 1 ||
    representation?.format.toLowerCase() !== "pdf" ||
    representation.file_id !== map.file_id ||
    representation.source_sha256 !== map.source_sha256
  )
    throw new IdentificationContractError("sheet_map_source_mismatch");
  if (
    !Number.isSafeInteger(representation.page_count) ||
    representation.page_count > 500 ||
    representation.page_count < 1
  )
    throw new IdentificationContractError("sheet_map_page_count_unsupported");
  const pages = [
    ...map.sheets.map((sheet) => sheet.page_number),
    ...map.excluded_pages,
  ];
  if (
    pages.length !== representation.page_count ||
    pages.some((page) => page > representation.page_count)
  )
    throw new IdentificationContractError("sheet_map_coverage_incomplete");
  if (revision.sheet_replacement) {
    const replacement = validateSheetReplacement(revision.sheet_replacement);
    if (revision.approval.replaces_revision_id)
      throw new IdentificationContractError(
        "sheet_replacement_conflicts_with_full_replacement",
      );
    if (
      replacement.replaced_labels.length !== map.sheets.length ||
      map.sheets.some(
        (sheet) => !replacement.replaced_labels.includes(sheet.label),
      )
    )
      throw new IdentificationContractError(
        "sheet_replacement_labels_mismatch",
      );
  }
}

export function structuralSheetBlockers(
  revision: IdentificationRevision,
): string[] {
  let mapValid = false;
  try {
    validateRevisionSheetMap(revision);
    mapValid = Boolean(revision.sheet_map && revision.sheet_replacement);
  } catch {
    /* fail closed */
  }
  return revision.blockers.filter((blocker) => {
    if (blocker === "unsupported_partial_replacement" && mapValid) return false;
    if (blocker.startsWith("field_conflict:"))
      return !revision.fields[
        blocker.slice(15) as keyof typeof revision.fields
      ];
    return (
      blocker.startsWith("unsupported_") ||
      blocker === "source_unreadable" ||
      blocker === "source_integrity_mismatch"
    );
  });
}

/** A 1:1 replacement only: no additions, deletions, renumbering or inferred stamps. */
export function resolveSheetSet(
  documents: IdentificationDocument[],
  revisionId: string,
  period?: { from: string | null; to: string | null },
): { selection: ResolvedSheetSet | null; blockers: string[] } {
  const byId = new Map(
    documents.flatMap((document) =>
      document.revisions.map(
        (revision) => [revision.revision_id, { document, revision }] as const,
      ),
    ),
  );
  const path = new Set<string>();
  const visit = (id: string): ResolvedSheetSet | null => {
    if (path.has(id) || path.size >= 32)
      throw new IdentificationContractError("sheet_replacement_cycle_or_depth");
    path.add(id);
    const located = byId.get(id);
    if (!located)
      throw new IdentificationContractError("sheet_replacement_target_missing");
    const { document, revision } = located;
    validateRevisionSheetMap(revision);
    if (!revision.sheet_map) return null;
    if (structuralSheetBlockers(revision).length)
      throw new IdentificationContractError("sheet_source_evidence_unresolved");
    if (period) {
      const approval = revision.approval;
      if (
        !approval.confirmed ||
        !approval.basis?.trim() ||
        !isIdentificationDate(approval.effective_from) ||
        !isIdentificationDate(period.from) ||
        !isIdentificationDate(period.to) ||
        period.from > period.to ||
        approval.effective_from > period.from ||
        (approval.effective_to !== null &&
          (!isIdentificationDate(approval.effective_to) ||
            approval.effective_to < period.to))
      )
        throw new IdentificationContractError(
          "sheet_source_applicability_unconfirmed",
        );
    }
    const map = revision.sheet_map;
    const rep = revision.representations[0]!;
    const ownSheets = map.sheets.map((sheet) => ({
      ...sheet,
      document_id: document.document_id,
      revision_id: revision.revision_id,
      file_id: rep.file_id,
      artifact_id: rep.artifact_id,
      artifact_sha256: rep.artifact_sha256,
      source_sha256: rep.source_sha256,
    }));
    let sheets = ownSheets;
    let chain: ResolvedSheetSet["chain"] = [];
    if (revision.sheet_replacement) {
      const parent = byId.get(
        revision.sheet_replacement.predecessor_revision_id,
      );
      if (
        !parent ||
        !identity(revision.fields.code) ||
        identity(parent.revision.fields.code) !==
          identity(revision.fields.code) ||
        !identity(revision.fields.scope) ||
        identity(parent.revision.fields.scope) !==
          identity(revision.fields.scope) ||
        parent.revision.fields.stage !== revision.fields.stage ||
        parent.revision.fields.kind_code !== revision.fields.kind_code
      )
        throw new IdentificationContractError(
          "sheet_replacement_target_invalid",
        );
      const inherited = visit(parent.revision.revision_id);
      if (!inherited)
        throw new IdentificationContractError("sheet_predecessor_map_required");
      const labels = revision.sheet_replacement.replaced_labels;
      if (
        labels.some(
          (label) => !inherited.sheets.some((sheet) => sheet.label === label),
        )
      )
        throw new IdentificationContractError(
          "sheet_replacement_unknown_label",
        );
      sheets = [
        ...inherited.sheets.filter((sheet) => !labels.includes(sheet.label)),
        ...ownSheets,
      ];
      chain = inherited.chain;
    }
    sheets.sort((a, b) => a.label.localeCompare(b.label));
    // Artifact record IDs change during cache reuse; original content and
    // decisions determine whether an unchanged inspector decision can carry.
    const decisionHash = hash({
      map: {
        ...map,
        sheets: [...map.sheets].sort((a, b) => a.label.localeCompare(b.label)),
        excluded_pages: [...map.excluded_pages].sort((a, b) => a - b),
      },
      replacement: revision.sheet_replacement ?? null,
      approval: revision.approval,
      fields: revision.fields,
    });
    chain = [...chain, { revision_id: id, decision_hash: decisionHash }];
    return {
      sheets,
      chain,
      selection_hash: hash({
        chain,
        sheets: sheets.map((sheet) =>
          Object.fromEntries(
            Object.entries(sheet).filter(([key]) => key !== "artifact_id"),
          ),
        ),
      }),
    };
  };
  try {
    return { selection: visit(revisionId), blockers: [] };
  } catch (error) {
    return {
      selection: null,
      blockers: [
        error instanceof IdentificationContractError
          ? error.code
          : "sheet_selection_invalid",
      ],
    };
  }
}
