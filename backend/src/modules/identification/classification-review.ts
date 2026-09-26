import type { ClassificationResult } from "./classification-contract.js";
import type {
  IdentificationField,
  IdentificationFields,
  IdentificationSnapshot,
  RevisionClarification,
} from "./identification-contract.js";
import type { DocumentAlias } from "./identification-grouping.js";

/** A read projection of the immutable document card, never a classifier rewrite. */
export interface ClassificationReview {
  document_id: string;
  revision_id: string;
  card_version: number;
  resolved_input_hash: string;
  fields: IdentificationFields;
  confirmed_fields: IdentificationField[];
  needs_review: boolean;
  reasons: string[];
  source_issues: string[];
}

export interface ClassificationReviewSnapshot extends IdentificationSnapshot {
  document_aliases?: DocumentAlias[];
  decision_ids?: string[];
}

interface ReviewDecision {
  id: string;
  documentId: string;
  revisionId: string;
  basis: string;
  patch: unknown;
}

export function classificationReview(
  snapshot: ClassificationReviewSnapshot,
  resolvedInputHash: string,
  fileId: string,
  artifactId: string,
  machine: ClassificationResult | null,
  decisions: ReviewDecision[],
): ClassificationReview | null {
  const document = snapshot.documents.find((item) =>
    item.revisions.some((revision) =>
      revision.representations.some(
        (part) => part.file_id === fileId && part.artifact_id === artifactId,
      ),
    ),
  );
  const revision = document?.revisions.find((item) =>
    item.representations.some(
      (part) => part.file_id === fileId && part.artifact_id === artifactId,
    ),
  );
  if (!document || !revision) return null;

  const aliases = (snapshot.document_aliases ?? []).filter(
    (alias) =>
      alias.canonical_document_id === document.document_id &&
      alias.canonical_revision_id === revision.revision_id,
  );
  const identities = aliases.length
    ? aliases
    : [
        {
          document_id: document.document_id,
          revision_id: revision.revision_id,
        },
      ];
  const decisionIds = new Set(snapshot.decision_ids ?? []);
  const confirmedByIdentity = identities.map((identity) => {
    const fields: Partial<Record<IdentificationField, string | null>> = {};
    for (const decision of decisions) {
      if (
        !decisionIds.has(decision.id) ||
        !decision.basis.trim() ||
        decision.documentId !== identity.document_id ||
        decision.revisionId !== identity.revision_id
      )
        continue;
      const patch = decision.patch as RevisionClarification;
      if (patch.revision_id !== identity.revision_id) continue;
      Object.assign(fields, patch.fields);
    }
    return fields;
  });
  // A grouped card is reviewed only where every merged source was explicitly
  // confirmed. Observations and reference links are not own classification.
  const confirmedFields = (
    Object.keys(revision.fields) as IdentificationField[]
  )
    .filter(
      (field) =>
        !field.startsWith("observed_") &&
        field !== "reference_code" &&
        Boolean(revision.fields[field]?.trim()) &&
        confirmedByIdentity.every(
          (fields) => fields[field] === revision.fields[field],
        ),
    )
    .sort();
  const reasons = revision.blockers.filter((reason) =>
    reason.startsWith("field_conflict:"),
  );
  if (!revision.fields.stage) reasons.push("stage_unresolved");
  const sourceIssues = revision.blockers.filter(
    (reason) =>
      reason.startsWith("unsupported_") || reason.startsWith("source_"),
  );
  if (machine?.reasons.includes("partial_parse_requires_review"))
    sourceIssues.push("partial_parse_requires_review");
  const humanClassification =
    confirmedFields.includes("stage") ||
    (Boolean(revision.fields.stage) && confirmedFields.includes("kind_code"));
  // Partial reading is an independent source issue. Confirming metadata cannot
  // hide it, while a source issue alone does not demand the same metadata again.
  if (
    machine?.needs_review &&
    !humanClassification &&
    !machine.reasons.includes("partial_parse_requires_review")
  )
    reasons.push("classification_confirmation_required");
  return {
    document_id: document.document_id,
    revision_id: revision.revision_id,
    card_version: document.card_version,
    resolved_input_hash: resolvedInputHash,
    fields: { ...revision.fields },
    confirmed_fields: confirmedFields,
    needs_review: reasons.length > 0,
    reasons: [...new Set(reasons)].sort(),
    source_issues: [...new Set(sourceIssues)].sort(),
  };
}
