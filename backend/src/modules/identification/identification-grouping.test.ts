import { describe, expect, it } from "vitest";
import type {
  IdentificationDocument,
  IdentificationRevision,
} from "./identification-contract.js";
import { groupResolvedDocuments } from "./identification-grouping.js";

function revision(id: string, format = "PDF"): IdentificationRevision {
  return {
    revision_id: id,
    fields: {
      stage: "ID",
      kind_code: "AOSR",
      title: "Акт",
      number: "52",
      date: "2026-04-20",
      scope: "оси 1–3",
      works_from: "2026-04-20",
      works_to: "2026-04-21",
    },
    candidates: [],
    representations: [
      {
        file_id: `file-${id}`,
        artifact_id: `artifact-${id}`,
        source_sha256: `sha-${id}`,
        artifact_sha256: `artifact-sha-${id}`,
        format,
        page_count: 1,
      },
    ],
    approval: {
      confirmed: false,
      effective_from: null,
      effective_to: null,
      replaces_revision_id: null,
      basis: null,
    },
    blockers: [],
    reference_revision_id: null,
  };
}
const doc = (
  id: string,
  value: IdentificationRevision,
  version = 1,
): IdentificationDocument => ({
  document_id: id,
  card_version: version,
  revisions: [value],
});

describe("immutable logical document grouping", () => {
  it("merges corrected PDF/XML identity, retaining originals and their versions in aliases", () => {
    const first = doc("a", revision("revision-b"), 3);
    const second = doc("b", revision("revision-a", "XML"), 7);
    const originals = structuredClone([first, second]);
    const result = groupResolvedDocuments([second, first]);
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).toMatchObject({
      document_id: "a",
      card_version: 3,
    });
    expect(result.documents[0]!.revisions).toHaveLength(1);
    expect(result.documents[0]!.revisions[0]!.revision_id).toBe("revision-a");
    expect(result.documents[0]!.revisions[0]!.representations).toHaveLength(2);
    expect(result.document_aliases).toEqual([
      {
        document_id: "a",
        revision_id: "revision-b",
        card_version: 3,
        canonical_document_id: "a",
        canonical_revision_id: "revision-a",
      },
      {
        document_id: "b",
        revision_id: "revision-a",
        card_version: 7,
        canonical_document_id: "a",
        canonical_revision_id: "revision-a",
      },
    ]);
    expect([first, second]).toEqual(originals);
    expect(result).toEqual(groupResolvedDocuments([first, second]));
  });
  it("adopts a confirmed approval without losing it to canonical sort order", () => {
    const first = revision("a");
    const second = revision("b", "XML");
    second.approval = {
      confirmed: true,
      effective_from: "2026-01-01",
      effective_to: null,
      replaces_revision_id: null,
      basis: "Проверено",
    };
    expect(
      groupResolvedDocuments([doc("a", first), doc("b", second)]).documents[0]!
        .revisions[0]!.approval,
    ).toEqual(second.approval);
  });
  it("preserves distinct revisions when confirmed decisions conflict", () => {
    const first = revision("a");
    const second = revision("b", "XML");
    first.approval = {
      confirmed: true,
      effective_from: "2026-01-01",
      effective_to: null,
      replaces_revision_id: null,
      basis: "Первое основание",
    };
    second.approval = {
      ...first.approval,
      effective_from: "2026-02-01",
      basis: "Другое основание",
    };
    expect(
      groupResolvedDocuments([doc("a", first), doc("b", second)]).documents[0]!
        .revisions,
    ).toHaveLength(2);
    second.approval = { ...first.approval };
    first.reference_revision_id = "ref-1";
    second.reference_revision_id = "ref-2";
    expect(
      groupResolvedDocuments([doc("a", first), doc("b", second)]).documents[0]!
        .revisions,
    ).toHaveLength(2);
  });
  it("groups PD/RD revisions by complete logical code/kind/scope without conflating editions", () => {
    const first = revision("a");
    const second = revision("b");
    first.fields = {
      stage: "RD",
      kind_code: "KJ",
      code: "23.009-КЖ",
      scope: "оси 1–3",
      revision_label: "1",
    };
    second.fields = { ...first.fields, revision_label: "2" };
    const result = groupResolvedDocuments([doc("a", first), doc("b", second)]);
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]!.revisions).toHaveLength(2);
  });
  it("does not group missing, conflicting or unrelated identity scopes", () => {
    for (const kind of [
      "missing",
      "different",
      "unsupported",
      "conflict",
    ] as const) {
      const first = revision("a");
      const second = revision("b", "XML");
      if (kind === "missing") delete second.fields.scope;
      if (kind === "different") second.fields.scope = "оси 4–6";
      if (kind === "unsupported")
        second.blockers = ["unsupported_mixed_document"];
      if (kind === "conflict") second.blockers = ["field_conflict:number"];
      expect(
        groupResolvedDocuments([doc("a", first), doc("b", second)]).documents,
      ).toHaveLength(2);
    }
  });
  it("remaps references and replacement IDs through merged revision aliases", () => {
    const pdf = revision("a");
    const xml = revision("b", "XML");
    const next = revision("c");
    next.fields.number = "53";
    next.reference_revision_id = "b";
    next.approval.replaces_revision_id = "b";
    const result = groupResolvedDocuments([
      doc("a", pdf),
      doc("b", xml),
      doc("c", next),
    ]);
    const mergedNext = result.documents.find(
      (item) => item.document_id === "c",
    )!.revisions[0]!;
    expect(mergedNext.reference_revision_id).toBe("a");
    expect(mergedNext.approval.replaces_revision_id).toBe("a");
  });
  it("does not split a persisted document with incomplete sibling identity", () => {
    const first = revision("a");
    const unknown = revision("b");
    delete unknown.fields.scope;
    const persisted = doc("a", first);
    persisted.revisions.push(unknown);
    const result = groupResolvedDocuments([
      persisted,
      doc("c", revision("c", "XML")),
    ]);
    expect(result.documents).toHaveLength(2);
    expect(
      result.documents.find((item) => item.document_id === "a")!.revisions,
    ).toHaveLength(2);
  });
});
