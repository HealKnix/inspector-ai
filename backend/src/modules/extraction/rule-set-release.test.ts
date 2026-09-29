import { describe, expect, it } from "vitest";
import { regressionEngines, reviewHash } from "./matrix-review-contract.js";
import {
  matrixCodes,
  releaseFingerprint,
  releaseRules,
  validateRelease,
  type ReleaseManifest,
} from "./rule-set-release.js";
function manifest(count: number): ReleaseManifest {
  const entries = matrixCodes.slice(0, count).map((code, i) => ({
    parameter_code: code,
    rule_version_id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    version: 1,
    plan: {
      kind: "regex",
      anchors: ["synthetic"],
      pattern: "(synthetic)",
      type: "text",
    },
    comparison: { kind: "equals" },
    applicability: null,
    passport_id: "synthetic-only",
    passport_hash: "a".repeat(64),
    regression_report_id: "synthetic-only",
    regression_report_hash: "b".repeat(64),
    rule_hash: "c".repeat(64),
  }));
  return {
    schema_version: 1,
    mode: "full",
    catalog: {
      import_id: "synthetic-only",
      catalog_sha256: "d".repeat(64),
      origin_sha256: null,
      row_count: 132,
    },
    entries,
    engines: regressionEngines,
    extraction_fingerprint: releaseFingerprint(entries),
    omitted_parameter_codes: matrixCodes.slice(count),
  };
}
describe("release structure (synthetic; server gate separately checks real report references)", () => {
  it("rejects 131, duplicates, forged coverage and unsupported operators", () => {
    expect(() => validateRelease(manifest(131))).toThrow("132");
    expect(() => validateRelease(manifest(132))).not.toThrow();
    const duplicate = manifest(132);
    duplicate.entries[131] = duplicate.entries[0]!;
    expect(() => validateRelease(duplicate)).toThrow("повторный");
    const coverage = manifest(131);
    coverage.omitted_parameter_codes = [];
    expect(() => validateRelease(coverage)).toThrow("Покрытие");
    const unsupported = manifest(132);
    unsupported.entries[0]!.comparison = { kind: "execute_code" };
    expect(() => validateRelease(unsupported)).toThrow("неподдерживаемый");
  });
  it("refuses corrupt content and unsupported worker engines", () => {
    const full = manifest(132),
      hash = reviewHash(full);
    expect(releaseRules(full, hash)).toHaveLength(132);
    full.entries[0]!.version++;
    expect(() => releaseRules(full, hash)).toThrow("целостность");
    const stale = manifest(132);
    stale.engines = { ...stale.engines, comparison: "old" };
    expect(() => validateRelease(stale)).toThrow("исполнителями");
  });
});
