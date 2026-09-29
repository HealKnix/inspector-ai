import {
  IdentificationContractError,
  type IdentificationDocument,
  type IdentificationRevision,
} from "./identification-contract.js";
import {
  canMergeRepresentations,
  normalizeIdentificationText,
} from "./identification-engine.js";
import { structuralSheetBlockers } from "./sheet-selection.js";

export interface DocumentAlias {
  document_id: string;
  revision_id: string;
  card_version: number;
  canonical_document_id: string;
  canonical_revision_id: string;
}

export interface GroupedResolvedDocuments {
  documents: IdentificationDocument[];
  document_aliases: DocumentAlias[];
}

const normalized = (value: string | undefined) =>
  normalizeIdentificationText(value ?? "").toLocaleLowerCase("ru-RU");

/** Identity within one process; the service supplies the object/process boundary. */
function logicalKey(revision: IdentificationRevision): string | null {
  if (
    revision.blockers.some((blocker) =>
      blocker.startsWith("field_conflict:"),
    ) ||
    structuralSheetBlockers(revision).some(
      (blocker) =>
        blocker.startsWith("unsupported_") ||
        blocker.startsWith("field_conflict:") ||
        blocker === "source_unreadable",
    )
  )
    return null;
  const fields = revision.fields;
  const values =
    fields.stage === "ID"
      ? [
          fields.stage,
          fields.kind_code,
          fields.number,
          fields.date,
          fields.scope,
          fields.works_from,
          fields.works_to,
        ]
      : fields.stage === "PD" || fields.stage === "RD"
        ? [fields.stage, fields.kind_code, fields.code, fields.scope]
        : [];
  if (!values.length || values.some((value) => !normalized(value))) return null;
  return JSON.stringify(values.map(normalized));
}

function compatibleDecisions(
  left: IdentificationRevision,
  right: IdentificationRevision,
): boolean {
  if (
    left.sheet_map ||
    right.sheet_map ||
    left.sheet_replacement ||
    right.sheet_replacement
  )
    return false;
  if (
    left.reference_revision_id &&
    right.reference_revision_id &&
    left.reference_revision_id !== right.reference_revision_id
  )
    return false;
  if (
    left.approval.replaces_revision_id &&
    right.approval.replaces_revision_id &&
    left.approval.replaces_revision_id !== right.approval.replaces_revision_id
  )
    return false;
  if (left.approval.confirmed && right.approval.confirmed) {
    // Different explanations can confirm the same fact; differing applicable
    // periods/replacement decisions are unresolved and must not be collapsed.
    return (
      left.approval.effective_from === right.approval.effective_from &&
      left.approval.effective_to === right.approval.effective_to &&
      left.approval.replaces_revision_id === right.approval.replaces_revision_id
    );
  }
  return true;
}

function combine(
  target: IdentificationRevision,
  incoming: IdentificationRevision,
) {
  const representations = new Map(
    [...target.representations, ...incoming.representations].map((item) => [
      `${item.file_id}:${item.artifact_id}`,
      item,
    ]),
  );
  target.representations = [...representations.values()].sort(
    (a, b) =>
      a.artifact_id.localeCompare(b.artifact_id) ||
      a.file_id.localeCompare(b.file_id),
  );
  const candidates = new Map(
    [...target.candidates, ...incoming.candidates].map((item) => [
      item.candidate_id,
      item,
    ]),
  );
  target.candidates = [...candidates.values()].sort((a, b) =>
    a.candidate_id.localeCompare(b.candidate_id),
  );
  if (!target.approval.confirmed && incoming.approval.confirmed)
    target.approval = structuredClone(incoming.approval);
  if (!target.reference_revision_id && incoming.reference_revision_id)
    target.reference_revision_id = incoming.reference_revision_id;
  // An external ID present only in XML is preserved without redefining the
  // internal identity; observed values remain fully available in candidates.
  if (!target.fields.external_id && incoming.fields.external_id)
    target.fields.external_id = incoming.fields.external_id;
  target.blockers = [
    ...new Set([...target.blockers, ...incoming.blockers]),
  ].sort();
}

/**
 * Pure grouping of an immutable selection. Originals and DB identities remain
 * untouched; aliases let the service route optimistic edits to every source.
 */
export function groupResolvedDocuments(
  originalDocuments: IdentificationDocument[],
): GroupedResolvedDocuments {
  const input = structuredClone(originalDocuments).sort((a, b) =>
    a.document_id.localeCompare(b.document_id),
  );
  const documentIds = new Set<string>();
  const revisionIds = new Set<string>();
  const buckets = new Map<string, IdentificationDocument[]>();
  for (const document of input) {
    if (documentIds.has(document.document_id))
      throw new IdentificationContractError(
        "identification_duplicate_document",
      );
    documentIds.add(document.document_id);
    for (const revision of document.revisions) {
      if (revisionIds.has(revision.revision_id))
        throw new IdentificationContractError(
          "identification_duplicate_revision",
        );
      revisionIds.add(revision.revision_id);
    }
    const keys = document.revisions.map(logicalKey);
    // Never split a persisted logical document just because one of its
    // revisions has incomplete or conflicting metadata.
    const shared =
      keys.length && keys.every((key) => key !== null && key === keys[0])
        ? `identity:${keys[0]}`
        : `document:${document.document_id}`;
    const bucket = buckets.get(shared) ?? [];
    bucket.push(document);
    buckets.set(shared, bucket);
  }
  const documents: IdentificationDocument[] = [];
  const aliases: DocumentAlias[] = [];
  for (const bucket of buckets.values()) {
    const first = bucket[0]!;
    const canonical: IdentificationDocument = {
      document_id: first.document_id,
      card_version: first.card_version,
      revisions: [],
    };
    const sources = bucket
      .flatMap((document) =>
        document.revisions.map((revision) => ({ document, revision })),
      )
      .sort((a, b) =>
        a.revision.revision_id.localeCompare(b.revision.revision_id),
      );
    for (const { document, revision } of sources) {
      let target = canonical.revisions.find(
        (candidate) =>
          canMergeRepresentations(candidate, revision) &&
          compatibleDecisions(candidate, revision),
      );
      if (!target) {
        target = structuredClone(revision);
        canonical.revisions.push(target);
      } else combine(target, revision);
      aliases.push({
        document_id: document.document_id,
        revision_id: revision.revision_id,
        card_version: document.card_version,
        canonical_document_id: canonical.document_id,
        canonical_revision_id: target.revision_id,
      });
    }
    documents.push(canonical);
  }
  const revisionAliases = new Map(
    aliases.map((alias) => [alias.revision_id, alias.canonical_revision_id]),
  );
  for (const document of documents)
    for (const revision of document.revisions) {
      if (revision.reference_revision_id)
        revision.reference_revision_id =
          revisionAliases.get(revision.reference_revision_id) ??
          revision.reference_revision_id;
      if (revision.approval.replaces_revision_id)
        revision.approval.replaces_revision_id =
          revisionAliases.get(revision.approval.replaces_revision_id) ??
          revision.approval.replaces_revision_id;
      if (revision.sheet_replacement)
        revision.sheet_replacement.predecessor_revision_id =
          revisionAliases.get(
            revision.sheet_replacement.predecessor_revision_id,
          ) ?? revision.sheet_replacement.predecessor_revision_id;
      if (revision.approval.replaces_revision_id === revision.revision_id)
        revision.blockers = [
          ...new Set([...revision.blockers, "replacement_cycle"]),
        ].sort();
    }
  return {
    documents: documents.sort((a, b) =>
      a.document_id.localeCompare(b.document_id),
    ),
    document_aliases: aliases.sort(
      (a, b) =>
        a.document_id.localeCompare(b.document_id) ||
        a.revision_id.localeCompare(b.revision_id),
    ),
  };
}
