import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  fieldMetrics,
  groupMetrics,
  levenshtein,
  normalizeText,
  objectBootstrap,
  ocrMetrics,
  rectangleIoU,
} from "./metrics.mjs";
import { validateSubmission } from "./submission.mjs";

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../docs/acceptance/fixtures/${name}`, import.meta.url),
      "utf8",
    ),
  );
const proof = {
  object_id: "synthetic-object",
  stage: "PD",
  document_code: "synthetic-code",
  revision: "synthetic-revision",
  file_id: "synthetic-file",
  pdf_page_number: 1,
  bbox: [0, 0, 1, 1],
};
const point = (location, case_type) => ({
  object_id: "synthetic-object",
  parameter_code: "synthetic-parameter",
  location,
  section: "synthetic-section",
  difference_type: "synthetic-difference",
  case_type,
  evidence: [proof],
});
const output = (p, decision) => ({ ...p, decision });

describe("independent metric controls, no model or corpus labels", () => {
  it("uses NFC, whitespace normalization, explicit case policy and preserves signs", () => {
    expect(normalizeText(" и\u0306   X ")).toBe("й X");
    expect(normalizeText("A", true)).toBe("a");
    expect(normalizeText("−1")).not.toBe(normalizeText("1"));
  });
  it("counts Unicode code points and asymmetric OCR insertions", () => {
    expect(levenshtein("😀", "")).toBe(1);
    expect(levenshtein("ab", "abc")).toBe(1);
  });
  it("matches hand calculation CER=1/5, WER=1/3, accuracy=.8", () => {
    const result = ocrMetrics([
      {
        kind: "printed",
        dpi: 300,
        expected: "a b c",
        actual: "a b x",
        status: "PROCESSED",
      },
    ]);
    expect(result.character_accuracy).toBe(0.8);
    expect(result.cer).toBe(0.2);
    expect(result.wer).toBe(1 / 3);
  });
  it("does not drop eligible abstentions from OCR denominator", () => {
    const result = ocrMetrics([
      {
        kind: "printed",
        dpi: 300,
        expected: "abc",
        actual: "",
        status: "ABSTAIN",
      },
    ]);
    expect(result.character_accuracy).toBe(0);
    expect(result.processing_coverage).toBe(0);
    expect(result.abstention_rate).toBe(1);
  });
  it("requires exclusions before run and reports excluded coverage", () => {
    const result = ocrMetrics([
      {
        kind: "handwriting",
        dpi: 300,
        premarked_exclusion: true,
        status: "LOW_QUALITY",
      },
    ]);
    expect(result.character_accuracy).toBeNull();
    expect(result.eligibility_coverage).toBe(0);
    expect(result.errors).toEqual([]);
    expect(
      ocrMetrics([{ kind: "unreadable", status: "PROCESSED" }]).errors,
    ).toHaveLength(2);
  });
  it("never treats an empty sample as perfect", () => {
    expect(ocrMetrics([]).character_accuracy).toBeNull();
    expect(fieldMetrics([]).exact_match).toBeNull();
    expect(groupMetrics([], []).f1).toBeNull();
  });
  it("uses per-field exact match without removing decimal/sign differences", () => {
    expect(
      fieldMetrics([
        { expected: "1.0", actual: "1" },
        { expected: "РД", actual: "рд", case_insensitive: true },
        { expected: "A", actual: null },
      ]),
    ).toMatchObject({
      total: 3,
      correct: 1,
      exact_match: 1 / 3,
      coverage: 2 / 3,
    });
  });
  it("computes exact normalized IoU at threshold and rejects impossible geometry", () => {
    expect(rectangleIoU([0, 0, 1, 1], [0, 0, 0.5, 1])).toBe(0.5);
    expect(() => rectangleIoU([0, 0, 0, 1], [0, 0, 1, 1])).toThrow();
  });
  it("matches hand calculation TP=FP=FN=TN=1", () => {
    const refs = [
      point("1", "confirmed_positive"),
      point("2", "confirmed_positive"),
      point("3", "verified_negative"),
      point("4", "verified_negative"),
    ];
    const result = groupMetrics(refs, [
      output(refs[0], "VIOLATION"),
      output(refs[1], "ABSTAIN"),
      output(refs[2], "VIOLATION"),
      output(refs[3], "CLEAR"),
    ]);
    expect(result).toMatchObject({
      tp: 1,
      fp: 1,
      fn: 1,
      tn: 1,
      precision: 0.5,
      recall: 0.5,
      f1: 0.5,
      fpr: 0.5,
      coverage: 0.75,
      abstention: 0.25,
    });
  });
  it("wrong evidence is both unmatched predicted finding and missed positive", () => {
    const ref = point("1", "confirmed_positive");
    const result = groupMetrics(
      [ref],
      [
        {
          ...output(ref, "VIOLATION"),
          evidence: [{ ...proof, pdf_page_number: 2 }],
        },
      ],
    );
    expect(result).toMatchObject({
      tp: 0,
      fp: 1,
      fn: 1,
      linkage: 1,
      localization: 0,
    });
  });
  it("scores the complete group, including missing stage and stale edition", () => {
    const ref = {
      ...point("1", "confirmed_positive"),
      evidence: [proof, { ...proof, stage: "RD", file_id: "other-file" }],
    };
    expect(
      groupMetrics(
        [ref],
        [output(point("1", "confirmed_positive"), "VIOLATION")],
      ),
    ).toMatchObject({ linkage: 0, localization: 0 });
    const stale = {
      ...point("2", "revision_conflict"),
      obsolete_revision_case: true,
    };
    expect(groupMetrics([stale], [output(stale, "VIOLATION")])).toMatchObject({
      fp: 1,
      fpr: 1,
    });
  });
  it("rejects duplicates rather than counting grouped locations twice", () => {
    const ref = point("1", "confirmed_positive");
    expect(() => groupMetrics([ref, ref], [])).toThrow();
    expect(() =>
      groupMetrics([ref], [output(ref, "CLEAR"), output(ref, "VIOLATION")]),
    ).toThrow();
  });
  it("does not manufacture independent confidence from one object", () => {
    expect(
      objectBootstrap([{ object_id: "one" }], () => 1).interval,
    ).toBeNull();
    const rows = [
      { object_id: "a", value: 0 },
      { object_id: "b", value: 1 },
    ];
    expect(
      objectBootstrap(
        rows,
        (r) => r.reduce((n, v) => n + v.value, 0) / r.length,
      ).interval,
    ).toEqual([0, 1]);
  });
});

describe("exact external schema and separate semantic checks", () => {
  it("accepts saved valid shape and rejects page zero", () => {
    expect(
      validateSubmission(fixture("submission-valid.synthetic.json")),
    ).toMatchObject({ schema_valid: true, semantic_valid: true });
    expect(
      validateSubmission(fixture("submission-invalid.synthetic.json"))
        .schema_valid,
    ).toBe(false);
  });
  it("does not change official permissive schema while enforcing evidence semantics", () => {
    const value = fixture("submission-valid.synthetic.json");
    value.checks[0].evidence = [];
    expect(validateSubmission(value)).toMatchObject({
      schema_valid: true,
      semantic_valid: false,
    });
    value.checks[0].violation_label = "MISSING_DOCUMENT";
    expect(validateSubmission(value).semantic_valid).toBe(true);
  });
  it("rejects unknown parameter, another object and out-of-range page", () => {
    const value = fixture("submission-valid.synthetic.json");
    value.checks[0].parameter_code = "NOT-A-MATRIX-CODE";
    value.checks[0].evidence[0].pdf_page_number = 999999;
    value.object_id = "OBJ-NOVOSLOBODSKAYA";
    const errors = validateSubmission(value).semantic_errors.join(" ");
    expect(errors).toContain("unknown_parameter_code");
    expect(errors).toContain("file_object_mismatch");
    expect(errors).toContain("page_out_of_range");
  });
  it("rejects duplicate atomic locations and empty output separately from schema", () => {
    const value = fixture("submission-valid.synthetic.json");
    value.checks.push(globalThis.structuredClone(value.checks[0]));
    expect(validateSubmission(value).semantic_valid).toBe(false);
    value.checks = [];
    expect(validateSubmission(value)).toMatchObject({
      schema_valid: true,
      semantic_valid: false,
    });
  });
});
