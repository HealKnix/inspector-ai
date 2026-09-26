import { describe, expect, it } from "vitest";
import type { ClassificationResult } from "./classification-contract.js";
import {
  classificationReview,
  type ClassificationReviewSnapshot,
} from "./classification-review.js";
import { emptyRevisionApproval } from "./identification-engine.js";

function fixture() {
  const snapshot: ClassificationReviewSnapshot = {
    schema_version: 1,
    documents: [
      {
        document_id: "document",
        card_version: 3,
        revisions: [
          {
            revision_id: "revision",
            fields: { stage: "RD", code: "23-ГИ" },
            approval: emptyRevisionApproval(),
            candidates: [],
            blockers: [],
            representations: [
              {
                file_id: "file",
                artifact_id: "artifact",
                artifact_sha256: "a",
                source_sha256: "s",
                format: "PDF",
                page_count: 1,
              },
            ],
          },
        ],
      },
    ],
    contexts: [],
    blockers: [],
    decision_ids: ["decision"],
  };
  const machine: ClassificationResult = {
    schema_version: 1,
    stage: null,
    document_kind: null,
    method: "none",
    needs_review: true,
    reasons: ["no_reliable_own_evidence"],
    evidence: [],
    candidates: [],
    versions: {
      classifier: "test",
      rules: "test",
      context: "test",
      prompt: "test",
      model: null,
    },
  };
  const decision = {
    id: "decision",
    documentId: "document",
    revisionId: "revision",
    basis: "Сверено с титулом",
    patch: { revision_id: "revision", fields: { stage: "RD" } },
  };
  return { snapshot, machine, decision };
}

describe("current document-card projection for the upload list", () => {
  it("accepts explicit stage-only confirmation without inventing kind or approval", () => {
    const { snapshot, machine, decision } = fixture();
    const result = classificationReview(
      snapshot,
      "hash",
      "file",
      "artifact",
      machine,
      [decision],
    );
    expect(result).toMatchObject({
      confirmed_fields: ["stage"],
      needs_review: false,
      fields: { stage: "RD" },
      source_issues: [],
    });
    expect(result?.fields.kind_code).toBeUndefined();
    expect(snapshot.documents[0]!.revisions[0]!.approval.confirmed).toBe(false);
    expect(machine.needs_review).toBe(true);
  });

  it("retains partial reading and mixed-document issues after metadata confirmation", () => {
    const { snapshot, machine, decision } = fixture();
    machine.reasons.push("partial_parse_requires_review");
    snapshot.documents[0]!.revisions[0]!.blockers = [
      "unsupported_mixed_document",
      "source_unreadable",
    ];
    expect(
      classificationReview(snapshot, "hash", "file", "artifact", machine, [
        decision,
      ]),
    ).toMatchObject({
      needs_review: false,
      confirmed_fields: ["stage"],
      source_issues: [
        "partial_parse_requires_review",
        "source_unreadable",
        "unsupported_mixed_document",
      ],
    });
  });

  it("does not claim confirmation from an approval-only decision or another snapshot", () => {
    const { snapshot, machine, decision } = fixture();
    const approvalOnly = {
      ...decision,
      patch: {
        revision_id: "revision",
        approval: {
          ...emptyRevisionApproval(),
          confirmed: true,
          basis: "Решение",
        },
      },
    };
    expect(
      classificationReview(snapshot, "hash", "file", "artifact", machine, [
        approvalOnly,
      ]),
    ).toMatchObject({ confirmed_fields: [], needs_review: true });
    snapshot.decision_ids = [];
    expect(
      classificationReview(snapshot, "hash", "file", "artifact", machine, [
        decision,
      ]),
    ).toMatchObject({ confirmed_fields: [], needs_review: true });
  });

  it("requires the exact representation and never borrows another artifact's review", () => {
    const { snapshot, machine, decision } = fixture();
    expect(
      classificationReview(snapshot, "hash", "file", "old-artifact", machine, [
        decision,
      ]),
    ).toBeNull();
  });

  it("does not clear an unresolved field conflict with an unrelated confirmation", () => {
    const { snapshot, machine, decision } = fixture();
    snapshot.documents[0]!.revisions[0]!.blockers = ["field_conflict:code"];
    expect(
      classificationReview(snapshot, "hash", "file", "artifact", machine, [
        decision,
      ]),
    ).toMatchObject({ needs_review: true, reasons: ["field_conflict:code"] });
  });

  it("requires matching explicit values for all aliases of a merged card", () => {
    const { snapshot, machine, decision } = fixture();
    snapshot.document_aliases = [
      {
        document_id: "document",
        revision_id: "revision",
        card_version: 2,
        canonical_document_id: "document",
        canonical_revision_id: "revision",
      },
      {
        document_id: "other-document",
        revision_id: "other-revision",
        card_version: 2,
        canonical_document_id: "document",
        canonical_revision_id: "revision",
      },
    ];
    expect(
      classificationReview(snapshot, "hash", "file", "artifact", machine, [
        decision,
      ])?.confirmed_fields,
    ).toEqual([]);
    snapshot.decision_ids!.push("other-decision");
    expect(
      classificationReview(snapshot, "hash", "file", "artifact", machine, [
        decision,
        {
          ...decision,
          id: "other-decision",
          documentId: "other-document",
          revisionId: "other-revision",
          patch: { revision_id: "other-revision", fields: { stage: "RD" } },
        },
      ])?.confirmed_fields,
    ).toEqual(["stage"]);
  });
});
