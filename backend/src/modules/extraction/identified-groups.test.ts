import { describe, expect, it } from "vitest";
import type {
  IdentificationRevision,
  IdentificationSnapshot,
} from "../identification/identification-contract.js";
import {
  identifiedGroups,
  type IdentifiedExtraction,
} from "./identified-groups.js";

function revision(id: string, files: string[]): IdentificationRevision {
  return {
    revision_id: id,
    fields: { scope: "A" },
    candidates: [],
    blockers: [],
    approval: {
      confirmed: true,
      basis: "Титул проверен",
      effective_from: "2026-01-01",
      effective_to: null,
      replaces_revision_id: null,
    },
    representations: files.map((file) => ({
      file_id: file,
      artifact_id: file,
      artifact_sha256: `artifact-${file}`,
      source_sha256: `source-${file}`,
      format: "PDF",
      page_count: 1,
    })),
  };
}
function row(file: string, value: number): IdentifiedExtraction {
  return {
    extraction_id: file,
    file_id: file,
    artifact_id: file,
    stage: "ID",
    role: "unknown",
    status: "extracted",
    value,
    value_raw: String(value),
    unit: "м2",
    evidence: [{ quote: `${value} м2`, pageNumber: 1 }],
  };
}
function fixture(): IdentificationSnapshot {
  return {
    schema_version: 1,
    blockers: [],
    documents: [
      {
        document_id: "rd",
        card_version: 1,
        revisions: [revision("r1", ["rd-jan"]), revision("r2", ["rd-feb"])],
      },
      {
        document_id: "act1",
        card_version: 1,
        revisions: [revision("a1", ["a1-pdf", "a1-xml"])],
      },
      {
        document_id: "act2",
        card_version: 1,
        revisions: [revision("a2", ["a2-pdf"])],
      },
    ],
    contexts: [
      {
        context_id: "jan",
        actual: { document_id: "act1", revision_id: "a1" },
        reference: { document_id: "rd", revision_id: "r1" },
        scope: "A",
        works_period: { from: "2026-01-02", to: "2026-01-03" },
        status: "READY",
        blockers: [],
      },
      {
        context_id: "feb",
        actual: { document_id: "act2", revision_id: "a2" },
        reference: { document_id: "rd", revision_id: "r2" },
        scope: "A",
        works_period: { from: "2026-02-02", to: "2026-02-03" },
        status: "READY",
        blockers: [],
      },
    ],
  };
}
describe("identified comparison groups", () => {
  it("ручная связь редакций не расширяет стадии утверждённого правила", () => {
    const snapshot = fixture();
    snapshot.documents[1]!.revisions[0]!.fields.stage = "ID";
    snapshot.documents[1]!.revisions[0]!.reference_revision_id = "r1";
    snapshot.documents[0]!.revisions[0]!.fields.stage = "RD";
    const result = identifiedGroups(
      snapshot,
      [row("rd-jan", 100), row("a1-pdf", 100), row("a1-xml", 100)],
      { kind: "equals" },
      ["PD", "RD"],
    )[0]!;
    expect(result.verdict.status).toBe("not_comparable");
    expect(result.verdict.identity_blockers).toContain(
      "comparison_rule_pairing_unconfirmed",
    );
  });
  it("два акта выбирают свои редакции без смешивания и PDF/XML не дублируют значение", () => {
    const groups = identifiedGroups(
      fixture(),
      [
        row("rd-jan", 100),
        row("rd-feb", 200),
        row("a1-pdf", 100),
        row("a1-xml", 100),
        row("a2-pdf", 201),
      ],
      { kind: "equals" },
    );
    expect(groups.map((group) => group.verdict.status)).toEqual([
      "match",
      "discrepancy",
    ]);
    expect(groups[0]?.members.map((member) => member.file_id)).not.toContain(
      "rd-feb",
    );
    expect(groups[0]?.verdict.actual).toHaveLength(1);
    expect(groups[1]?.members.map((member) => member.file_id)).not.toContain(
      "a1-pdf",
    );
  });
  it("неполное/неопределенное основание и конфликт представлений не дают match", () => {
    const source = fixture();
    source.contexts[0]!.status = "CLARIFICATION_REQUIRED";
    source.contexts[0]!.blockers = ["period_unknown"];
    const rows = [row("rd-jan", 100), row("a1-pdf", 100), row("a1-xml", 100)];
    const blocked = identifiedGroups(source, rows, { kind: "equals" })[0]!;
    expect(blocked.verdict.status).toBe("not_comparable");
    expect(blocked.verdict.pairs).toEqual([]);
    source.contexts[0]!.status = "READY";
    source.contexts[0]!.blockers = [];
    expect(
      identifiedGroups(source, rows.slice(0, 2), { kind: "equals" })[0]!.verdict
        .identity_blockers,
    ).toContain("representation_extraction_incomplete");
    rows[2]!.value = 500;
    expect(
      identifiedGroups(source, rows, { kind: "equals" })[0]!.verdict.status,
    ).toBe("actual_ambiguous");
  });
});
