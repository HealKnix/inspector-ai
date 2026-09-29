import { describe, expect, it } from "vitest";
import {
  sheetDocuments,
  sheetId,
} from "../../../test/helpers/sheet-selection-fixture.js";
import { buildSelectionSnapshot } from "../identification/identification-engine.js";
import { groupResolvedDocuments } from "../identification/identification-grouping.js";
import type { ParseArtifactData } from "../parsing/parsing-contract.js";
import { membersFingerprint } from "../verification/protocol-builder.js";
import { validateExtractionPlan } from "./extraction-contract.js";
import type { ApprovedRule } from "./extraction-engine.js";
import {
  identifiedGroups,
  type IdentifiedExtraction,
} from "./identified-groups.js";
import {
  executeSelectedArtifact,
  selectedArtifactView,
} from "./selected-artifact.js";

const rule: ApprovedRule = {
  parameter_code: "P019",
  rule_version_id: sheetId(700),
  version: 1,
  comparison: { kind: "equals" },
  plan: validateExtractionPlan({
    kind: "regex",
    anchors: ["Коэффициент застройки"],
    pattern: "Коэффициент застройки\\s*:?\\s*(\\d+)\\s*%",
    unit: ["%"],
    number_policy: {
      version: "decimal-v1",
      mode: "single",
      reject_list_marker: true,
      require_unit: true,
    },
  }),
};
function artifact(values: (number | null)[]): ParseArtifactData {
  return {
    schema_version: 1,
    source_sha256: "a".repeat(64),
    pipeline_fingerprint: "f".repeat(64),
    versions: { parser: "synthetic" },
    quality: "OK",
    reasons: [],
    raw_text: "",
    normalized_text: "",
    coverage: {
      total_pages: values.length,
      readable_pages: values.length,
      unreadable_pages: 0,
    },
    pages: values.map((value, i) => ({
      page_number: i + 1,
      sheet_label: null,
      width: 100,
      height: 100,
      image_key: "synthetic",
      image_sha256: "d".repeat(64),
      quality: "OK",
      reasons: [],
      transform: {},
      blocks:
        value === null
          ? []
          : [
              {
                id: `p${i + 1}:b1`,
                order: 0,
                kind: "text",
                raw_text: `Коэффициент застройки: ${value} %`,
                normalized_text: `Коэффициент застройки: ${value} %`,
                bbox: [0, 0, 1, 1],
                confidence: null,
                source: "native",
                structural_path: null,
                table_id: null,
                row: null,
                column: null,
                row_span: null,
                column_span: null,
              },
            ],
    })),
  };
}
const snapshot = () =>
  buildSelectionSnapshot(groupResolvedDocuments(sheetDocuments()).documents);
function rows(snap = snapshot()): IdentifiedExtraction[] {
  const sources: [number, (number | null)[]][] = [
    [1, [99, 30, null, 99, null, null, null, 99]],
    [2, [30, null, null]],
    [3, [30]],
  ];
  return sources.flatMap(([id, values]) => {
    const artifact_id = sheetId(Number(id) + 200);
    return executeSelectedArtifact(artifact(values), artifact_id, snap, [
      rule,
    ]).map((outcome, index) => ({
      extraction_id: `${id}/${index}`,
      file_id: sheetId(Number(id) + 100),
      artifact_id,
      selection_key: outcome.selection_key,
      stage: Number(id) === 3 ? "ID" : "RD",
      role: "unknown" as const,
      status: outcome.status,
      value: outcome.value,
      value_raw: outcome.value_raw,
      unit: outcome.unit,
      ...(outcome.numerical ? { numerical: outcome.numerical } : {}),
      evidence: outcome.evidence.map((e) => ({
        pageNumber: e.page_number,
        sheetLabel: e.sheet_label,
        quote: e.quote,
        blockId: e.block_id,
      })),
    }));
  });
}
describe("page-scoped extraction before search", () => {
  it("ignores replaced pages before regex and retains physical locators on inherited sheets", () => {
    const snap = snapshot();
    const context = snap.contexts.find(
      (c) => c.actual.revision_id === sheetId(3),
    )!;
    const original = artifact([99, 30, null, 99, null, null, null, 99]);
    const unchanged = structuredClone(original);
    const view = selectedArtifactView(
      original,
      sheetId(201),
      context.sheet_selection!.reference!,
    );
    expect(view.pages.map((p) => p.page_number)).toEqual([2, 3, 5, 6, 7]);
    expect(original).toEqual(unchanged);
    const all = rows(snap);
    const group = identifiedGroups(snap, all, rule.comparison).find(
      (g) => g.contextKey === context.context_id,
    )!;
    expect(group.verdict.status).toBe("match");
    expect(group.members.map((m) => m.value)).toEqual(["30", "30", "30"]);
    expect(
      group.members.find((m) => m.artifact_id === sheetId(201))!.evidence,
    ).toEqual([
      { pageNumber: 2, sheetLabel: "2", quote: "30", blockId: "p2:b1" },
    ]);
    expect(group.verdict.context).toEqual(context);
  });
  it("does not substitute legacy whole-artifact results or another context selection", () => {
    const snap = snapshot();
    const context = snap.contexts.find(
      (c) => c.actual.revision_id === sheetId(3),
    )!;
    const wrong = rows(snap).map((row) => ({ ...row, selection_key: null }));
    const result = identifiedGroups(snap, wrong, rule.comparison).find(
      (g) => g.contextKey === context.context_id,
    )!;
    expect(result.verdict.status).toBe("not_comparable");
    expect(result.verdict.identity_blockers).toContain(
      "representation_extraction_incomplete",
    );
    const wrongPage = rows(snap);
    wrongPage.find((r) => r.artifact_id === sheetId(201))!.evidence = [
      { pageNumber: 1, quote: "old sheet" },
    ];
    expect(
      identifiedGroups(snap, wrongPage, rule.comparison).find(
        (g) => g.contextKey === context.context_id,
      )!.verdict.identity_blockers,
    ).toContain("sheet_extraction_locator_mismatch");
  });
  it("refuses nonexistent/unreadable selected pages and preserves incomplete information", () => {
    const snap = snapshot();
    const selection = snap.contexts.find(
      (c) => c.actual.revision_id === sheetId(3),
    )!.sheet_selection!.reference!;
    expect(() =>
      selectedArtifactView(artifact([30]), sheetId(201), selection),
    ).toThrow("sheet_selection_page_missing");
    const input = artifact([30, 30, 30]);
    for (const page of input.pages) page.quality = "ABSTAIN";
    const outcomes = executeSelectedArtifact(input, sheetId(202), snap, [rule]);
    expect(outcomes.length).toBeGreaterThan(0);
    expect(outcomes.every((o) => o.status === "unreadable")).toBe(true);
  });
  it("keeps carryover stable across PAR cache records but invalidates changed sheet decisions", () => {
    const snap = snapshot();
    const groups = identifiedGroups(snap, rows(snap), rule.comparison);
    const group = groups.find((g) => g.verdict.status === "match")!;
    const before = membersFingerprint(group.members, group.verdict, new Map());
    const cached = structuredClone(group);
    const ctx = cached.verdict.context as (typeof snap.contexts)[number];
    for (const sheet of ctx.sheet_selection!.reference!.sheets)
      sheet.artifact_id = sheetId(999);
    for (const member of cached.members) member.artifact_id = sheetId(999);
    expect(membersFingerprint(cached.members, cached.verdict, new Map())).toBe(
      before,
    );
    ctx.sheet_selection!.reference!.chain[0]!.decision_hash = "e".repeat(64);
    expect(
      membersFingerprint(cached.members, cached.verdict, new Map()),
    ).not.toBe(before);
  });
  it("does not infer parameter applicability from READY sources for composite rules", () => {
    const snap = snapshot();
    const result = identifiedGroups(snap, rows(snap), {
      kind: "composite",
      schema_version: 1,
      root: {
        id: "all",
        kind: "and",
        children: [
          { id: "same", kind: "scalar", comparison: { kind: "equals" } },
          { id: "same-again", kind: "scalar", comparison: { kind: "equals" } },
        ],
      },
    }).find(
      (g) =>
        g.verdict.context &&
        (g.verdict.context as { status: string }).status === "READY",
    )!;
    expect(result.verdict.status).toBe("not_comparable");
    expect(result.verdict.composite?.applicability).toBe("unknown");
    expect(result.verdict.composite?.root.children[0]?.evaluated).toBe(false);
  });
});
