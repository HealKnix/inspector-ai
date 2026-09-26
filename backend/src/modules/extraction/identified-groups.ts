import { createHash } from "node:crypto";
import { canonicalJson } from "../documents/canonical-json.js";
import type {
  IdentificationRevision,
  IdentificationSnapshot,
  RevisionReference,
} from "../identification/identification-contract.js";
import type { ComparisonSpec } from "./comparison-contract.js";
import { evaluateGroup, type GroupMember } from "./comparison-engine.js";

export interface IdentifiedExtraction extends GroupMember {
  artifact_id: string;
}

/** Only explicit resolved contexts may assign expected/actual roles. */
export function identifiedGroups(
  snapshot: IdentificationSnapshot,
  rows: IdentifiedExtraction[],
  spec: ComparisonSpec | null,
  allowedStages?: string[],
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
      for (const representation of rev.representations) {
        if (!rows.some((row) => row.artifact_id === representation.artifact_id))
          blockers.push("representation_extraction_incomplete");
        for (const row of rows.filter(
          (row) => row.artifact_id === representation.artifact_id,
        )) {
          members.push({
            ...row,
            role,
            document_id: ref.document_id,
            revision_id: ref.revision_id,
            artifact_sha256: representation.artifact_sha256,
            source_sha256: representation.source_sha256,
          });
        }
      }
    }
    const verdict = evaluateGroup(members, spec);
    verdict.context = context;
    // Proof content, parser versions and inspector approval remain semantic
    // inputs; only per-run artifact record IDs are excluded from carryover.
    const basis = (rev: IdentificationRevision | undefined) =>
      rev
        ? {
            fields: rev.fields,
            approval: rev.approval,
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
