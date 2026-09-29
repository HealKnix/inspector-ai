import { describe, expect, it } from "vitest";
import type {
  AnalysisRequestIndex,
  DiscoveryCandidateIndex,
  SectionCandidate,
} from "./section-contract.js";
import {
  validateAnalysisResponse,
  validateDiscoveryResponse,
  validateSectionMatrixRows,
} from "./section-contract.js";

// Synthetic fixtures only; no real documents are used in unit tests.

function row(code = "P1") {
  return {
    parameter_code: code,
    name: "Синтетический параметр",
    unit: "мм",
    source_pd: "ПД раздел 1",
    source_rd: null,
    source_id: null,
    trigger: "всегда",
  };
}

describe("validateSectionMatrixRows", () => {
  it("accepts real bounded rows and rejects unknown/duplicate/missing fields", () => {
    const rows = validateSectionMatrixRows([row()]);
    expect(rows[0]!.parameter_code).toBe("P1");
    expect(() => validateSectionMatrixRows([])).toThrow();
    expect(() => validateSectionMatrixRows([{ ...row(), extra: 1 }])).toThrow(
      /unknown_field/,
    );
    expect(() => validateSectionMatrixRows([{ name: "x" }])).toThrow(
      /missing_field/,
    );
    expect(() => validateSectionMatrixRows([row(), row()])).toThrow(
      /duplicate_code/,
    );
    expect(() => validateSectionMatrixRows([{ ...row("BAD CODE!") }])).toThrow(
      /invalid_code/,
    );
  });
});

function candidate(
  sourceRef: string,
  blockId: string,
  position: number,
): SectionCandidate {
  return {
    candidate_id: `${sourceRef}:c${position}`,
    source_ref: sourceRef,
    block_id: blockId,
    page_number: 1,
    kind: "heading",
    text: "Раздел 1",
    structural_path: null,
    possible_end_block_ids: [blockId, "b9"],
    neighbors: { before: null, after: null },
  };
}

function index(): DiscoveryCandidateIndex {
  const c0 = candidate("reference:0", "b2", 0);
  const c1 = candidate("reference:0", "b5", 1);
  const a0 = candidate("actual:0", "d2", 0);
  return {
    candidates: new Map([c0, c1, a0].map((c) => [c.candidate_id, c])),
    anchors: new Map([
      ["reference:0\nb2", { candidate: c0, position: 0 }],
      ["reference:0\nb5", { candidate: c1, position: 1 }],
      ["actual:0\nd2", { candidate: a0, position: 0 }],
    ]),
    // b4 sits before anchor position 1 — an exact boundary usable by c0.
    endAnchors: new Map([
      [
        "reference:0",
        new Map([
          ["b4", 1],
          ["b8", 2],
        ]),
      ],
      ["actual:0", new Map([["d9", 1]])],
    ]),
    lastBlockIds: new Map([
      ["reference:0", "b9"],
      ["actual:0", "d9"],
    ]),
    sourceRefs: new Set(["reference:0", "actual:0"]),
    requestedCodes: new Set(["P1", "P2"]),
  };
}

function section(over: Record<string, unknown> = {}) {
  return {
    source_ref: "reference:0",
    title: "Раздел 1",
    start_block_id: "b2",
    end_block_id: "b4",
    parameter_codes: ["P1"],
    ...over,
  };
}

describe("validateDiscoveryResponse", () => {
  const wrap = (sections: unknown[], extra: Record<string, unknown> = {}) => ({
    sections,
    expand: [],
    missing_context: [],
    ...extra,
  });

  it("accepts an exact boundary end that was not listed in the manifest", () => {
    // "b4" was omitted from possible_end_block_ids but is a real boundary.
    const out = validateDiscoveryResponse(wrap([section()]), index());
    expect(out.sections[0]!.end_block_id).toBe("b4");
  });

  it("rejects unknown anchors, foreign sources and reversed ends", () => {
    expect(
      () =>
        validateDiscoveryResponse(
          wrap([section({ start_block_id: "bX" })]),
          index(),
        ).sections,
    ).toThrow(/unknown_anchor/);
    expect(
      () =>
        validateDiscoveryResponse(
          wrap([section({ source_ref: "actual:9" })]),
          index(),
        ).sections,
    ).toThrow(/foreign_source/);
    // "b1" precedes the anchor and is not a boundary at all.
    expect(
      () =>
        validateDiscoveryResponse(
          wrap([section({ end_block_id: "b1" })]),
          index(),
        ).sections,
    ).toThrow(/invalid_end/);
    // A boundary earlier than the anchor (position 0 end for anchor at 1).
    expect(
      () =>
        validateDiscoveryResponse(
          wrap([section({ start_block_id: "b5", end_block_id: "b4" })]),
          index(),
        ).sections,
    ).toThrow(/invalid_end/);
  });

  it("rejects cross-source ends, foreign parameters and duplicates", () => {
    expect(
      () =>
        validateDiscoveryResponse(
          wrap([section({ end_block_id: "d9" })]),
          index(),
        ).sections,
    ).toThrow(/invalid_end/);
    expect(
      () =>
        validateDiscoveryResponse(
          wrap([section({ parameter_codes: ["P9"] })]),
          index(),
        ).sections,
    ).toThrow(/foreign_parameter/);
    expect(
      () =>
        validateDiscoveryResponse(wrap([section(), section()]), index())
          .sections,
    ).toThrow(/duplicate_section/);
    expect(() =>
      validateDiscoveryResponse(wrap([section()], { unknown: 1 }), index()),
    ).toThrow(/invalid/);
  });

  it("accepts the full 132-code coverage of one shared section", () => {
    const codes = Array.from({ length: 132 }, (_, i) => `P${i}`);
    const idx = index();
    idx.requestedCodes = new Set(codes);
    const out = validateDiscoveryResponse(
      wrap([section({ parameter_codes: codes })]),
      idx,
    );
    expect(out.sections[0]!.parameter_codes).toHaveLength(132);
  });
});

describe("validateAnalysisResponse", () => {
  const request: AnalysisRequestIndex = {
    codes: new Set(["P1", "P2"]),
    blocks: new Map([
      [
        "reference:0\nr1",
        { role: "reference", text: "Толщина стены 200 мм по проекту" },
      ],
      [
        "actual:0\na1",
        { role: "actual", text: "Толщина стены 200 мм исполнительно" },
      ],
    ]),
    sourceRefs: new Map([
      ["reference:0", "reference"],
      ["actual:0", "actual"],
    ]),
  };
  const item = (over: Record<string, unknown> = {}) => ({
    parameter_code: "P1",
    assessment: "proposed_agreement",
    fact: "Толщина совпадает",
    evidence: [
      {
        source_ref: "reference:0",
        block_id: "r1",
        quote: "200 мм по проекту",
      },
      {
        source_ref: "actual:0",
        block_id: "a1",
        quote: "200 мм исполнительно",
      },
    ],
    missing_context: [],
    question_for_inspector: null,
    ...over,
  });
  const wrap = (results: unknown[]) => ({ results });

  it("accepts a grounded result citing both roles exactly", () => {
    const out = validateAnalysisResponse(
      wrap([item(), { ...item(), parameter_code: "P2" }]),
      request,
    );
    expect(out).toHaveLength(2);
  });

  it("rejects one-sided evidence for grounded assessments", () => {
    const oneSided = item({
      evidence: [item().evidence[0]],
    });
    expect(() =>
      validateAnalysisResponse(
        wrap([oneSided, { ...item(), parameter_code: "P2" }]),
        request,
      ),
    ).toThrow(/one_sided_evidence/);
  });

  it("rejects inexact, whitespace, foreign and cross-request quotes", () => {
    const bad = (quote: string) =>
      item({
        evidence: [
          { source_ref: "reference:0", block_id: "r1", quote },
          item().evidence[1],
        ],
      });
    for (const quote of ["", "   ", "не было в блоке", "200 мm"])
      expect(() =>
        validateAnalysisResponse(
          wrap([bad(quote), { ...item(), parameter_code: "P2" }]),
          request,
        ),
      ).toThrow();
    expect(() =>
      validateAnalysisResponse(
        wrap([
          item({
            evidence: [
              { source_ref: "actual:0", block_id: "a1", quote: "x" },
              item().evidence[0],
            ],
          }),
          { ...item(), parameter_code: "P2" },
        ]),
        request,
      ),
    ).toThrow(/quote_mismatch|foreign_block/);
  });

  it("rejects missing, duplicate, unknown and unsupported codes", () => {
    expect(() => validateAnalysisResponse(wrap([item()]), request)).toThrow(
      /missing_parameter/,
    );
    expect(() =>
      validateAnalysisResponse(
        wrap([item(), item(), { ...item(), parameter_code: "P2" }]),
        request,
      ),
    ).toThrow(/duplicate_parameter/);
    expect(() =>
      validateAnalysisResponse(
        wrap([
          item({ parameter_code: "ZZ" }),
          { ...item(), parameter_code: "P2" },
        ]),
        request,
      ),
    ).toThrow(/unknown_parameter/);
  });

  it("requires missing_context reasons for insufficient_context", () => {
    expect(() =>
      validateAnalysisResponse(
        wrap([
          item({
            assessment: "insufficient_context",
            fact: null,
            evidence: [],
            missing_context: [],
          }),
          { ...item(), parameter_code: "P2" },
        ]),
        request,
      ),
    ).toThrow(/missing_reason/);
    const ok = validateAnalysisResponse(
      wrap([
        item({
          assessment: "insufficient_context",
          fact: null,
          evidence: [],
          missing_context: ["раздел не найден"],
        }),
        { ...item(), parameter_code: "P2" },
      ]),
      request,
    );
    expect(ok[0]!.assessment).toBe("insufficient_context");
  });
});
