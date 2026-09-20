import { describe, expect, it } from "vitest";
import {
  ComparisonValidationError,
  validateComparisonSpec,
} from "./comparison-contract.js";
import { evaluateGroup, type GroupMember } from "./comparison-engine.js";

const NOW = new Date("2026-09-21T00:00:00Z");
let seq = 0;

function member(overrides: Partial<GroupMember>): GroupMember {
  seq += 1;
  return {
    extraction_id: `ex-${seq}`,
    file_id: `file-${seq}`,
    stage: null,
    role: "expected",
    status: "extracted",
    value: null,
    value_raw: null,
    unit: null,
    ...overrides,
  };
}

function expected(value: number | string, unit: string | null = null) {
  return member({ role: "expected", stage: "PD", value, unit });
}

function actual(value: number | string, unit: string | null = null) {
  return member({ role: "actual", stage: "RD", value, unit });
}

describe("validateComparisonSpec", () => {
  it("принимает допустимые спеки", () => {
    expect(validateComparisonSpec({ kind: "equals" })).toEqual({
      kind: "equals",
    });
    expect(
      validateComparisonSpec({ kind: "numeric_delta", tolerance_pct: 1 }),
    ).toEqual({ kind: "numeric_delta", tolerance_pct: 1 });
    expect(validateComparisonSpec({ kind: "no_decrease" }).kind).toBe(
      "no_decrease",
    );
    expect(validateComparisonSpec({ kind: "threshold", min: 300 })).toEqual({
      kind: "threshold",
      min: 300,
    });
  });

  it("отклоняет некорректные спеки", () => {
    expect(() => validateComparisonSpec(null)).toThrow(
      ComparisonValidationError,
    );
    expect(() => validateComparisonSpec({ kind: "fuzzy" })).toThrow(
      "неподдерживаемый вид",
    );
    expect(() =>
      validateComparisonSpec({ kind: "equals", extra: true }),
    ).toThrow("неизвестное поле");
    expect(() =>
      validateComparisonSpec({ kind: "numeric_delta", tolerance_pct: -1 }),
    ).toThrow("неотрицательное");
    expect(() =>
      validateComparisonSpec({ kind: "numeric_delta", tolerance_pct: 150 }),
    ).toThrow("100");
    expect(() => validateComparisonSpec({ kind: "threshold" })).toThrow(
      "граница",
    );
    expect(() =>
      validateComparisonSpec({ kind: "threshold", min: 5, max: 2 }),
    ).toThrow("min больше max");
  });
});

describe("evaluateGroup", () => {
  it("no_comparison при отсутствии спеки", () => {
    const verdict = evaluateGroup(
      [expected(100, "m2"), actual(100, "m2")],
      null,
      NOW,
    );
    expect(verdict.status).toBe("no_comparison");
    expect(verdict.evaluated_at).toBe(NOW.toISOString());
  });

  it("expected_missing при отсутствии извлечённого ПД-значения", () => {
    const verdict = evaluateGroup(
      [member({ role: "expected", status: "no_evidence" }), actual(100, "m2")],
      { kind: "equals" },
      NOW,
    );
    expect(verdict.status).toBe("expected_missing");
  });

  it("actual_missing — источник не передан, а не нарушение", () => {
    const verdict = evaluateGroup(
      [expected(100, "m2")],
      { kind: "equals" },
      NOW,
    );
    expect(verdict.status).toBe("actual_missing");
    expect(verdict.pairs).toHaveLength(0);
  });

  it("expected_ambiguous при конфликте внутри проектного базиса", () => {
    const verdict = evaluateGroup(
      [expected(13997.9, "m2"), expected(13999.7, "m2"), actual(13999.7, "m2")],
      { kind: "numeric_delta", tolerance_pct: 1 },
      NOW,
    );
    expect(verdict.status).toBe("expected_ambiguous");
    expect(verdict.expected).toHaveLength(2);
  });

  it("equals: совпадение и расхождение чисел", () => {
    expect(
      evaluateGroup([expected(159.95), actual(159.95)], { kind: "equals" }, NOW)
        .status,
    ).toBe("match");
    expect(
      evaluateGroup([expected(600), actual(620)], { kind: "equals" }, NOW)
        .status,
    ).toBe("discrepancy");
  });

  it("equals: текстовые значения нормализуются", () => {
    const verdict = evaluateGroup(
      [expected("В40", null), actual(" в40 ")],
      { kind: "equals" },
      NOW,
    );
    expect(verdict.status).toBe("match");
  });

  it("numeric_delta: граница допуска включительна", () => {
    const spec = { kind: "numeric_delta", tolerance_pct: 1 } as const;
    expect(
      evaluateGroup([expected(10000), actual(10100)], spec, NOW).status,
    ).toBe("match");
    expect(
      evaluateGroup([expected(10000), actual(10101)], spec, NOW).status,
    ).toBe("discrepancy");
  });

  it("no_decrease: понижение класса — discrepancy, уточнение — match", () => {
    const spec = { kind: "no_decrease" } as const;
    expect(evaluateGroup([expected(35), actual(30)], spec, NOW).status).toBe(
      "discrepancy",
    );
    expect(evaluateGroup([expected(40), actual(40)], spec, NOW).status).toBe(
      "match",
    );
  });

  it("threshold: значение ниже нормы — discrepancy", () => {
    const spec = { kind: "threshold", min: 300 } as const;
    const verdict = evaluateGroup([expected(280), actual(280)], spec, NOW);
    expect(verdict.status).toBe("discrepancy");
    expect(verdict.pairs.every((pair) => pair.detail === "below_min:300")).toBe(
      true,
    );
  });

  it("unit_mismatch даёт not_comparable, а не нарушение", () => {
    const verdict = evaluateGroup(
      [expected(100, "m2"), actual(100, "m3")],
      { kind: "numeric_delta", tolerance_pct: 1 },
      NOW,
    );
    expect(verdict.status).toBe("not_comparable");
    expect(verdict.pairs[0]?.detail).toBe("unit_mismatch");
  });

  it("нечисловое значение по числовой спеке — not_comparable", () => {
    const verdict = evaluateGroup(
      [expected("нет данных"), actual(100)],
      { kind: "no_decrease" },
      NOW,
    );
    expect(verdict.status).toBe("not_comparable");
  });

  it("одинаковые значения одной стадии дедуплицируются", () => {
    const verdict = evaluateGroup(
      [expected(159.95), expected(159.95), actual(159.95)],
      { kind: "equals" },
      NOW,
    );
    expect(verdict.status).toBe("match");
  });

  it("значение без единицы сливается с тем же значением с единицей", () => {
    const verdict = evaluateGroup(
      [expected(159.95, "m"), expected(159.95), actual(159.95, "m")],
      { kind: "equals" },
      NOW,
    );
    expect(verdict.status).toBe("match");
    expect(verdict.expected).toHaveLength(1);
    expect(verdict.expected?.[0]?.unit).toBe("m");
  });

  it("разные единицы одного значения остаются неоднозначностью", () => {
    const verdict = evaluateGroup(
      [expected(159.95, "m"), expected(159.95, "mm"), actual(159.95, "m")],
      { kind: "equals" },
      NOW,
    );
    expect(verdict.status).toBe("expected_ambiguous");
  });

  it("члены без стадии исключаются и фиксируются предупреждением", () => {
    const verdict = evaluateGroup(
      [
        expected(100),
        actual(100),
        member({ role: "unknown", stage: null, value: 42 }),
      ],
      { kind: "equals" },
      NOW,
    );
    expect(verdict.status).toBe("match");
    expect(verdict.warnings).toContain("unclassified_members");
  });

  it("actual_ambiguous при двух различных значениях РД", () => {
    const verdict = evaluateGroup(
      [expected(600), actual(600), actual(620)],
      { kind: "equals" },
      NOW,
    );
    expect(verdict.status).toBe("actual_ambiguous");
  });
});
