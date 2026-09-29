import { describe, expect, it } from "vitest";
import {
  syntheticPassport,
  syntheticPassportInput,
  syntheticRegressionFixtures,
  syntheticReviewRule,
} from "../../../test/helpers/matrix-review-fixture.js";
import { runRuleRegression } from "./matrix-regression.js";
import {
  reviewedRuleHash,
  reviewHash,
  validatePassportInput,
  validateRegressionInput,
} from "./matrix-review-contract.js";

describe("MAT-A deterministic regression", () => {
  it("executes extraction and comparison with exact values, units and locators without claiming corpus accuracy", () => {
    const fixtures = validateRegressionInput({
      schema_version: 1,
      fixtures: syntheticRegressionFixtures(),
    });
    const report = runRuleRegression(
      syntheticReviewRule,
      syntheticPassport(),
      fixtures,
    );
    expect(report.blockers).toEqual([]);
    expect(report.cases.flatMap((c) => c.errors)).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.quality).toMatchObject({
      synthetic_cases: 8,
      curated_cases: 0,
      corpus_accuracy: null,
    });
    expect(
      runRuleRegression(syntheticReviewRule, syntheticPassport(), fixtures),
    ).toEqual(report);
  });
  it("rejects fabricated fixture hashes, wrong values, units, locators and verdicts", () => {
    for (const change of [
      "hash",
      "value",
      "unit",
      "locator",
      "verdict",
    ] as const) {
      const fixtures = syntheticRegressionFixtures();
      const first = fixtures[0]!;
      if (change === "hash") first.inputs[0]!.artifact_sha256 = "0".repeat(64);
      if (change === "value") first.expected.extractions[0]!.value = 99;
      if (change === "unit") first.expected.extractions[0]!.unit = "m3";
      if (change === "locator")
        first.expected.extractions[0]!.evidence[0]!.page_number = 2;
      if (change === "verdict") first.expected.verdict = "match";
      expect(
        runRuleRegression(syntheticReviewRule, syntheticPassport(), fixtures)
          .passed,
      ).toBe(false);
    }
  });
  it("requires every non-waived category of each executable branch", () => {
    const report = runRuleRegression(
      syntheticReviewRule,
      syntheticPassport(),
      syntheticRegressionFixtures().filter((f) => f.category !== "negative"),
    );
    expect(report.blockers).toContain("extraction:missing_negative");
    expect(report.blockers).toContain("comparison:missing_negative");
    const passport = syntheticPassport();
    passport.branches[0]!.categories.negative =
      "Синтетическая проверка допустимого пояснённого исключения";
    expect(
      runRuleRegression(
        syntheticReviewRule,
        passport,
        syntheticRegressionFixtures().filter(
          (f) => f.id !== "extraction-negative",
        ),
      ).passed,
    ).toBe(true);
  });
  it("preserves unknown normative basis and blocks only dependent rule approval", () => {
    const passport = syntheticPassport();
    passport.branches[1]!.basis_required = true;
    expect(passport.branches[1]!.basis).toBeNull();
    expect(
      runRuleRegression(
        syntheticReviewRule,
        passport,
        syntheticRegressionFixtures(),
      ).blockers,
    ).toContain("comparison:unknown_basis");
    expect(
      runRuleRegression(
        {
          ...syntheticReviewRule,
          comparison: { kind: "numeric_delta", tolerance_abs: 1 },
        },
        syntheticPassport(),
        syntheticRegressionFixtures(),
      ).blockers,
    ).toContain("comparison:unknown_basis");
  });
  it("does not accept a declared future operator or mismatched engine version", () => {
    const passport = syntheticPassport();
    passport.branches[1]!.operator = "geometry";
    expect(
      runRuleRegression(
        syntheticReviewRule,
        passport,
        syntheticRegressionFixtures(),
      ).passed,
    ).toBe(false);
    passport.branches[0]!.version = "unknown-engine";
    expect(
      runRuleRegression(
        syntheticReviewRule,
        passport,
        syntheticRegressionFixtures(),
      ).blockers,
    ).toContain("extraction:unsupported_operator_version");
  });
  it("binds plan, comparison, applicability and passport content independently of JSON key order", () => {
    const hash = reviewedRuleHash(
      syntheticReviewRule,
      reviewHash(syntheticPassport()),
    );
    expect(
      reviewedRuleHash(
        {
          ...syntheticReviewRule,
          plan: { kind: "regex", anchors: ["changed"], pattern: "(\\d+)" },
        },
        reviewHash(syntheticPassport()),
      ),
    ).not.toBe(hash);
    expect(
      reviewedRuleHash(
        syntheticReviewRule,
        reviewHash({ ...syntheticPassport(), scope: "different" }),
      ),
    ).not.toBe(hash);
    expect(reviewHash({ b: 2, a: 1 })).toBe(reviewHash({ a: 1, b: 2 }));
  });
  it("requires explicit curated provenance and rejects forged report input", () => {
    const fixtures = syntheticRegressionFixtures();
    fixtures[0]!.provenance.kind = "curated";
    expect(
      runRuleRegression(syntheticReviewRule, syntheticPassport(), fixtures)
        .passed,
    ).toBe(false);
    expect(() =>
      validateRegressionInput({ schema_version: 1, fixtures, passed: true }),
    ).toThrow();
    expect(() =>
      validatePassportInput({
        ...syntheticPassportInput(),
        assumed_norm: "invented",
      }),
    ).toThrow();
  });
  it("rejects a misleading unit, unimplemented rounding and a relabelled certain case", () => {
    const passport = syntheticPassport();
    passport.unit = "m3";
    expect(
      runRuleRegression(
        syntheticReviewRule,
        passport,
        syntheticRegressionFixtures(),
      ).passed,
    ).toBe(false);
    passport.unit = "m2";
    passport.rounding = "Не реализованная тестовая политика";
    expect(
      runRuleRegression(
        syntheticReviewRule,
        passport,
        syntheticRegressionFixtures(),
      ).blockers,
    ).toContain("rounding_policy_mismatch");
    const fixtures = syntheticRegressionFixtures();
    fixtures[0]!.category = "uncertain";
    expect(
      runRuleRegression(syntheticReviewRule, syntheticPassport(), fixtures)
        .cases[0]!.errors,
    ).toContain("uncertain_case_has_no_uncertainty");
  });
});
