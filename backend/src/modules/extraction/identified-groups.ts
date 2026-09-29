import { createHash } from "node:crypto";
import { canonicalJson } from "../documents/canonical-json.js";
import type {
  IdentificationRevision,
  IdentificationSnapshot,
  RevisionReference,
} from "../identification/identification-contract.js";
import type { ComparisonSpec } from "./comparison-contract.js";
import {
  evaluateGroup,
  type GroupMember,
  type GroupVerdict,
} from "./comparison-engine.js";
import { sheetSelectionKey } from "./selected-artifact.js";

export interface IdentifiedExtraction extends GroupMember {
  artifact_id: string;
  selection_key?: string | null;
}

/** Only explicit resolved contexts may assign expected/actual roles. */
export function identifiedGroups(
  snapshot: IdentificationSnapshot,
  rows: IdentifiedExtraction[],
  spec: ComparisonSpec | null,
  allowedStages?: string[],
  ruleBasis?: GroupVerdict["rule_basis"],
) {
  const revision = (
    ref: RevisionReference | null,
  ): IdentificationRevision | undefined =>
    ref
      ? snapshot.documents
          .find((doc) => doc.document_id === ref.document_id)
          ?.revisions.find((rev) => rev.revision_id === ref.revision_id)
      : undefined;
  return snapshot.contexts.map((context) => {
    const actual = revision(context.actual);
    const expected = revision(context.reference);
    const members: GroupMember[] = [];
    const blockers = [...context.blockers];
    const binding = {
      context_id: context.context_id,
      scope_key: context.scope,
      period_key:
        context.works_period.from && context.works_period.to
          ? `${context.works_period.from}/${context.works_period.to}`
          : null,
    };
    if (
      allowedStages &&
      (!allowedStages.includes(actual?.fields.stage ?? "") ||
        !allowedStages.includes(expected?.fields.stage ?? ""))
    )
      blockers.push("comparison_rule_pairing_unconfirmed");
    for (const [ref, rev, role] of [
      [context.actual, actual, "actual"],
      [context.reference, expected, "expected"],
    ] as const) {
      if (!ref || !rev) continue;
      const selectionRole = role === "expected" ? "reference" : "actual";
      const selection = context.sheet_selection?.[selectionRole];
      if ((rev.sheet_map || rev.sheet_replacement) && !selection) {
        blockers.push("sheet_selection_unresolved");
        continue;
      }
      const selectionKey = selection
        ? sheetSelectionKey(context, selectionRole, selection)
        : null;
      const representations = selection
        ? [
            ...new Map(
              selection.sheets.map((sheet) => [sheet.artifact_id, sheet]),
            ).values(),
          ]
        : rev.representations;
      for (const representation of representations) {
        const selectedRows = rows.filter(
          (row) =>
            row.artifact_id === representation.artifact_id &&
            (row.selection_key ?? null) === selectionKey,
        );
        if (!selectedRows.length)
          blockers.push("representation_extraction_incomplete");
        for (const row of selectedRows) {
          if (
            selection &&
            (row.evidence ?? []).some(
              (proof) =>
                !proof ||
                typeof proof !== "object" ||
                !selection.sheets.some(
                  (sheet) =>
                    sheet.artifact_id === row.artifact_id &&
                    sheet.page_number ===
                      (proof as { pageNumber?: unknown }).pageNumber,
                ),
            )
          ) {
            blockers.push("sheet_extraction_locator_mismatch");
            continue;
          }
          members.push({
            ...row,
            role,
            document_id: ref.document_id,
            revision_id: ref.revision_id,
            artifact_sha256: representation.artifact_sha256,
            source_sha256: representation.source_sha256,
            comparison_context: binding,
          });
        }
      }
    }
    const verdict = evaluateGroup(members, spec, undefined, {
      ...binding,
      reference: context.reference,
      actual: context.actual,
      // A ready source selection is not confirmation of this parameter's
      // applicability. Until that decision exists, composite rules abstain.
      applicability: "unknown",
      applicability_basis: null,
    });
    if (ruleBasis) verdict.rule_basis = ruleBasis;
    verdict.context = context;
    // Proof content, parser versions and inspector approval remain semantic
    // inputs; only per-run artifact record IDs are excluded from carryover.
    const basis = (rev: IdentificationRevision | undefined) =>
      rev
        ? {
            fields: rev.fields,
            approval: rev.approval,
            ...(rev.sheet_map ? { sheet_map: rev.sheet_map } : {}),
            ...(rev.sheet_replacement
              ? { sheet_replacement: rev.sheet_replacement }
              : {}),
            candidates: rev.candidates.map((candidate) => ({
              ...Object.fromEntries(
                Object.entries(candidate).filter(
                  ([key]) => key !== "candidate_id" && key !== "evidence",
                ),
              ),
              evidence: candidate.evidence.map((proof) =>
                Object.fromEntries(
                  Object.entries(proof).filter(
                    ([key]) => key !== "artifact_id",
                  ),
                ),
              ),
            })),
          }
        : null;
    verdict.selection_basis = {
      actual: basis(actual),
      reference: basis(expected),
      ...(context.sheet_selection
        ? {
            sheet_selection: Object.fromEntries(
              Object.entries(context.sheet_selection).map(
                ([role, selection]) => [
                  role,
                  selection
                    ? {
                        selection_hash: selection.selection_hash,
                        chain: selection.chain,
                        sheets: selection.sheets.map((sheet) =>
                          Object.fromEntries(
                            Object.entries(sheet).filter(
                              ([key]) => key !== "artifact_id",
                            ),
                          ),
                        ),
                      }
                    : null,
                ],
              ),
            ),
          }
        : {}),
    };
    verdict.identity_blockers = [...new Set(blockers)];
    if (context.status !== "READY" || blockers.length) {
      verdict.status = "not_comparable";
      verdict.pairs = [];
      verdict.warnings.push(...verdict.identity_blockers);
    }
    const stableVerdict = Object.fromEntries(
      Object.entries(verdict).filter(([key]) => key !== "evaluated_at"),
    );
    return {
      contextKey: context.context_id,
      scopeKey: context.context_id,
      members,
      verdict,
      contentHash: createHash("sha256")
        .update(canonicalJson({ members, verdict: stableVerdict }))
        .digest("hex"),
    };
  });
}
