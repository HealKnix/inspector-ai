import type { IdentificationRevision } from "@/api/types/identification";
import { idRegistry } from "./identification-test-fixtures";
import {
  nextReviewQuestion,
  referenceOptions,
  reviewDocumentName,
  reviewFields,
} from "./review-card";

function fixture() {
  const registry = structuredClone(idRegistry);
  const document = registry.documents[0]!;
  const actual = document.revisions[0]!;
  Object.assign(actual.fields, {
    scope: "оси 14–17/А–Ж",
    works_from: "2026-04-20",
    works_to: "2026-04-20",
    reference_code: "23.009-Р-ГИ",
  });
  const reference: IdentificationRevision = {
    ...structuredClone(actual),
    revision_id: "33333333-3333-4333-8333-333333333333",
    fields: { stage: "RD", code: "23.009-Р-ГИ", scope: actual.fields.scope },
    approval: {
      confirmed: true,
      effective_from: "2026-01-01",
      effective_to: null,
      basis: "Синтетическое подтверждённое основание",
      replaces_revision_id: null,
    },
  };
  registry.documents.push({
    document_id: "44444444-4444-4444-8444-444444444444",
    card_version: 1,
    revisions: [reference],
  });
  registry.contexts.push({
    context_id: "synthetic-context",
    scope: actual.fields.scope!,
    works_period: {
      from: actual.fields.works_from!,
      to: actual.fields.works_to!,
    },
    actual: {
      document_id: document.document_id,
      revision_id: actual.revision_id,
    },
    reference: null,
    status: "CLARIFICATION_REQUIRED",
    blockers: [],
  });
  return { registry, document, actual, reference };
}

describe("inspector review questions and source choices", () => {
  it("shows a stage-only classification for explicit confirmation without inventing a kind", () => {
    const { reference } = fixture();
    expect(reviewFields(reference)).toContain("stage");
    expect(reference.fields.kind_code).toBeUndefined();
  });

  it("keeps ordinary act fields short but makes conflicting own metadata editable", () => {
    const { actual } = fixture();
    const fields = reviewFields(actual);
    expect(fields).toContain("number");
    expect(fields).not.toContain("observed_status");
    expect(fields).not.toContain("external_id");
    actual.blockers = [
      "field_conflict:title",
      "field_conflict:observed_edition",
    ];
    expect(reviewFields(actual)).toContain("title");
    expect(reviewFields(actual)).not.toContain("observed_edition");
  });

  it("names an unidentified document by its file instead of an internal UUID", () => {
    const { document, actual } = fixture();
    actual.fields = {};
    const filename = "Гидроизоляция.pdf";
    expect(
      reviewDocumentName(
        document,
        new Map([[actual.representations[0]!.file_id, filename]]),
      ),
    ).toBe(filename);
    expect(reviewDocumentName(document, new Map())).not.toContain(
      document.document_id.slice(0, 8),
    );
  });

  it("does not ask for manual pairing when a comparison is already resolved", () => {
    const { registry, actual, reference } = fixture();
    registry.contexts[0]!.status = "READY";
    registry.contexts[0]!.reference = {
      document_id: registry.documents[1]!.document_id,
      revision_id: reference.revision_id,
    };
    expect(nextReviewQuestion(registry, actual)).toBeNull();
  });

  it("keeps partial sheet replacement ahead of ordinary missing-field questions", () => {
    const { registry, actual } = fixture();
    delete actual.fields.scope;
    actual.blockers = [
      "unsupported_partial_replacement",
      "field_conflict:title",
    ];
    expect(nextReviewQuestion(registry, actual)).toMatchObject({
      kind: "restriction",
    });
    expect(nextReviewQuestion(registry, actual)?.text).toContain("лист");
  });

  it("excludes unrelated, unapproved, late and unsupported reference revisions", () => {
    const { registry, actual, reference } = fixture();
    const excluded = [
      {
        ...structuredClone(reference),
        fields: { ...reference.fields, stage: "PD" },
      },
      {
        ...structuredClone(reference),
        fields: { ...reference.fields, scope: "другие оси" },
      },
      {
        ...structuredClone(reference),
        fields: { ...reference.fields, code: "другой шифр" },
      },
      {
        ...structuredClone(reference),
        approval: { ...reference.approval, confirmed: false },
      },
      {
        ...structuredClone(reference),
        approval: { ...reference.approval, effective_from: "2026-05-01" },
      },
      {
        ...structuredClone(reference),
        blockers: ["unsupported_partial_replacement"],
      },
    ];
    excluded.forEach((revision, index) => {
      revision.revision_id = `excluded-${index}`;
      registry.documents[1]!.revisions.push(revision);
    });
    expect(
      referenceOptions(registry, actual, new Map()).map((item) => item.id),
    ).toEqual([reference.revision_id]);
  });

  it("asks a specific question when the server reports competing applicable revisions", () => {
    const { registry, actual } = fixture();
    registry.contexts[0]!.blockers = ["reference_ambiguous"];
    expect(nextReviewQuestion(registry, actual)).toMatchObject({
      kind: "reference",
    });
  });
});
