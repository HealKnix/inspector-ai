import { describe, expect, it } from "vitest";
import { validateComparisonSpec } from "./comparison-contract.js";
import { evaluateGroup, type GroupMember } from "./comparison-engine.js";
import {
  decimal,
  decimalRound,
  decimalText,
  normalizeDecimalInput,
} from "./exact-decimal.js";
import { unitDefinition, type NumericalPolicy } from "./numerical-policy.js";
const policy: NumericalPolicy = {
  version: "decimal-units-v1",
  target_unit: "m",
  zero_expected: "not_comparable",
  allow_percent_fraction: false,
  rounding: null,
};
function member(
  role: "expected" | "actual",
  point: string,
  unit: string | null = "m",
): GroupMember {
  const definition = unitDefinition(unit);
  return {
    extraction_id: role,
    file_id: role,
    role,
    stage: role === "expected" ? "PD" : "RD",
    status: "extracted",
    value: point,
    value_raw: `${point} ${unit ?? ""}`,
    unit,
    numerical: {
      schema_version: 1,
      decimal: point,
      unit:
        unit === null
          ? {
              raw: null,
              canonical: null,
              dimension: null,
              source: "missing",
              evidence: [],
            }
          : {
              raw: unit,
              canonical: definition?.canonical ?? null,
              dimension: definition?.dimension ?? null,
              source: "value",
              evidence: [
                {
                  page_number: 1,
                  sheet_label: null,
                  block_id: role,
                  table_id: null,
                  table_row: null,
                  table_column: null,
                  quote: `${point} ${unit}`,
                  bbox: [0.1, 0.1, 0.9, 0.2],
                  structural_path: null,
                },
              ],
            },
      uncertainty: null,
    },
  };
}
const evaluate = (members: GroupMember[], spec: unknown) =>
  evaluateGroup(members, validateComparisonSpec(spec));
describe("exact decimal comparisons (synthetic engineering cases)", () => {
  it("preserves digits beyond JS integer precision and exact tolerance edges", () => {
    const spec = {
      kind: "numeric_delta",
      tolerance_abs: "0.1",
      inclusive: true,
      numerical_policy: policy,
    };
    expect(
      evaluate(
        [
          member("expected", "9007199254740993"),
          member("actual", "9007199254740993.1"),
        ],
        spec,
      ).status,
    ).toBe("match");
    const result = evaluate(
      [
        member("expected", "9007199254740993"),
        member("actual", "9007199254740993.1000000001"),
      ],
      spec,
    );
    expect(result.status).toBe("discrepancy");
    expect(result.pairs[0]!.trace).toMatchObject({ delta: "0.1000000001" });
  });
  it("converts supported units with proof and refuses missing/incompatible units", () => {
    const spec = { kind: "equals", numerical_policy: policy };
    expect(
      evaluate([member("expected", "1"), member("actual", "1000", "mm")], spec)
        .status,
    ).toBe("match");
    for (const unit of [null, "kg", "unknown"])
      expect(
        evaluate([member("expected", "1"), member("actual", "1", unit)], spec)
          .status,
      ).toBe("not_comparable");
    const invalid = member("actual", "1");
    invalid.numerical!.unit.evidence = [];
    expect(evaluate([member("expected", "1"), invalid], spec).status).toBe(
      "not_comparable",
    );
    const structural = member("actual", "1");
    structural.numerical!.unit.evidence[0]!.bbox = null;
    structural.numerical!.unit.evidence[0]!.structural_path =
      "/document/body/p[2]";
    expect(evaluate([member("expected", "1"), structural], spec).status).toBe(
      "match",
    );
  });
  it("requires explicit percent conversion and zero-reference policy", () => {
    const spec = {
      kind: "equals",
      numerical_policy: { ...policy, target_unit: "%" },
    };
    expect(
      evaluate(
        [member("expected", "25", "%"), member("actual", "0.25", "1")],
        spec,
      ).status,
    ).toBe("not_comparable");
    expect(
      evaluate([member("expected", "25", "%"), member("actual", "0.25", "1")], {
        ...spec,
        numerical_policy: {
          ...spec.numerical_policy,
          allow_percent_fraction: true,
        },
      }).status,
    ).toBe("match");
    expect(
      evaluate([member("expected", "0"), member("actual", "0")], {
        kind: "numeric_delta",
        tolerance_pct: "1",
        inclusive: true,
        numerical_policy: policy,
      }).status,
    ).toBe("not_comparable");
  });
  it("keeps a rational relative delta and uncertain bounds", () => {
    const spec = {
      kind: "numeric_delta",
      tolerance_pct: "1",
      inclusive: true,
      numerical_policy: policy,
    };
    const result = evaluate(
      [member("expected", "3"), member("actual", "4")],
      spec,
    );
    expect(result.pairs[0]!.trace).toMatchObject({
      relative_delta: { numerator: "100", denominator: "3" },
    });
    const actual = member("actual", "10.1");
    actual.numerical!.uncertainty = {
      lower: "10",
      upper: "10.2",
      basis: {
        reference: "Synthetic measurement",
        version: "1",
        locator: "fixture",
      },
    };
    expect(evaluate([member("expected", "10"), actual], spec).status).toBe(
      "not_comparable",
    );
  });
  it("uses explicit inclusive thresholds and rounding modes", () => {
    const spec = {
      kind: "threshold",
      max: "0.3",
      max_inclusive: false,
      numerical_policy: policy,
    };
    expect(evaluate([member("actual", "0.3")], spec).status).toBe(
      "discrepancy",
    );
    expect(
      evaluate([member("actual", "0.3")], { ...spec, max_inclusive: true })
        .status,
    ).toBe("match");
    expect(decimalText(decimalRound(decimal("-1.25"), 1, "half_up"))).toBe(
      "-1.3",
    );
    expect(decimalText(decimalRound(decimal("-1.25"), 1, "half_even"))).toBe(
      "-1.2",
    );
  });
  it("compares categories only by the declared versioned map", () => {
    const spec = {
      kind: "ordered_category",
      direction: "no_decrease",
      map_version: "synthetic-1",
      ranks: { Low: 1, High: 2 },
      basis: {
        reference: "Synthetic classes",
        version: "1",
        locator: "fixture",
      },
    };
    expect(
      evaluate([member("expected", "High"), member("actual", "Low")], spec)
        .status,
    ).toBe("discrepancy");
    expect(
      evaluate([member("expected", "High"), member("actual", "III")], spec)
        .status,
    ).toBe("not_comparable");
    expect(() => validateComparisonSpec({ ...spec, basis: null })).toThrow();
  });
  it("rejects ambiguous separators and unbounded input", () => {
    expect(normalizeDecimalInput("−1 234,50")).toBe("-1234.5");
    for (const text of ["1,234.50", "1 23", "1.2.3", "1e1000"])
      expect(normalizeDecimalInput(text)).toBeNull();
    expect(() => decimal("1".repeat(81))).toThrow();
  });
  it.each([
    ["cm2", "10000", "m2", "1", "0.0001"],
    ["mm3", "1000000000", "m3", "1", "0.000000001"],
    ["m3", "1.25", "cm3", "1250000", "1000000"],
    ["g", "2500", "kg", "2.5", "0.001"],
    ["kV", "0.22", "V", "220", "1000"],
  ])(
    "converts %s to %s by its declared dimension exponent",
    (from, input, to, expected, factor) => {
      const result = evaluate(
        [member("expected", expected, to), member("actual", input, from)],
        {
          kind: "equals",
          numerical_policy: { ...policy, target_unit: to },
        },
      );
      expect(result.status).toBe("match");
      expect(result.pairs[0]!.trace).toMatchObject({
        actual: { converted: expected, conversion: { factor } },
      });
    },
  );
  it.each([
    ["no_increase", "-1", "match"],
    ["no_increase", "-0.999999999999999999999999999999", "discrepancy"],
    ["no_decrease", "-1", "match"],
    ["no_decrease", "-1.000000000000000000000000000001", "discrepancy"],
  ])("respects exact negative boundaries for %s", (kind, value, status) => {
    expect(
      evaluate([member("expected", "-1"), member("actual", value)], {
        kind,
        numerical_policy: policy,
      }).status,
    ).toBe(status);
  });
  it("keeps ambiguous OCR and missing units separate from a known value", () => {
    const unknown = member("actual", "1", null);
    const valid = member("actual", "1");
    const spec = { kind: "equals", numerical_policy: policy };
    const members = [member("expected", "1"), unknown, valid];
    const before = structuredClone(members);
    expect(evaluate(members, spec).status).toBe("actual_ambiguous");
    expect(members).toEqual(before);
    valid.status = "ambiguous";
    expect(evaluate([member("expected", "1"), valid], spec).status).toBe(
      "actual_ambiguous",
    );
    const missing = evaluate([member("expected", "1"), unknown], spec);
    expect(missing.status).toBe("not_comparable");
    expect(missing.pairs[0]!.trace).toMatchObject({
      expected: { decimal: "1" },
      reason: "unit_missing",
    });
  });
  it("rejects a point that contradicts its numerical provenance", () => {
    const actual = member("actual", "1");
    actual.value = "2";
    const result = evaluate([member("expected", "1"), actual], {
      kind: "equals",
      numerical_policy: policy,
    });
    expect(result.status).toBe("not_comparable");
    expect(result.pairs[0]!.detail).toBe("numerical_value_evidence_mismatch");
  });
});
