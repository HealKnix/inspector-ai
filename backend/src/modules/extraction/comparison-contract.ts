export const COMPARISON_ENGINE_VERSION = "comparison-engine-v1";

// --- Comparison specs stored in rule_versions.comparison ---

export interface EqualsSpec {
  kind: "equals";
}

export interface NumericDeltaSpec {
  kind: "numeric_delta";
  tolerance_abs?: number;
  tolerance_pct?: number;
}

export interface NoDecreaseSpec {
  kind: "no_decrease";
}

export interface NoIncreaseSpec {
  kind: "no_increase";
}

export interface ThresholdSpec {
  kind: "threshold";
  min?: number;
  max?: number;
}

export type ComparisonSpec =
  | EqualsSpec
  | NumericDeltaSpec
  | NoDecreaseSpec
  | NoIncreaseSpec
  | ThresholdSpec;

export class ComparisonValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComparisonValidationError";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tolerance(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1e12
  )
    throw new ComparisonValidationError(
      `${field}: неотрицательное число до 1e12`,
    );
  return value;
}

function bound(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new ComparisonValidationError(`${field}: конечное число`);
  return value;
}

export function validateComparisonSpec(value: unknown): ComparisonSpec {
  if (!record(value) || typeof value.kind !== "string")
    throw new ComparisonValidationError("comparison: объект с полем kind");
  switch (value.kind) {
    case "equals": {
      if (!Object.keys(value).every((key) => key === "kind"))
        throw new ComparisonValidationError("equals: неизвестное поле");
      return { kind: "equals" };
    }
    case "numeric_delta": {
      const allowed = new Set(["kind", "tolerance_abs", "tolerance_pct"]);
      if (!Object.keys(value).every((key) => allowed.has(key)))
        throw new ComparisonValidationError("numeric_delta: неизвестное поле");
      const spec: NumericDeltaSpec = { kind: "numeric_delta" };
      if (value.tolerance_abs !== undefined)
        spec.tolerance_abs = tolerance(value.tolerance_abs, "tolerance_abs");
      if (value.tolerance_pct !== undefined)
        spec.tolerance_pct = tolerance(value.tolerance_pct, "tolerance_pct");
      if (spec.tolerance_pct !== undefined && spec.tolerance_pct > 100)
        throw new ComparisonValidationError(
          "tolerance_pct: не больше 100 процентов",
        );
      return spec;
    }
    case "no_decrease":
    case "no_increase": {
      if (!Object.keys(value).every((key) => key === "kind"))
        throw new ComparisonValidationError(`${value.kind}: неизвестное поле`);
      return { kind: value.kind };
    }
    case "threshold": {
      const allowed = new Set(["kind", "min", "max"]);
      if (!Object.keys(value).every((key) => allowed.has(key)))
        throw new ComparisonValidationError("threshold: неизвестное поле");
      const spec: ThresholdSpec = { kind: "threshold" };
      if (value.min !== undefined) spec.min = bound(value.min, "min");
      if (value.max !== undefined) spec.max = bound(value.max, "max");
      if (spec.min === undefined && spec.max === undefined)
        throw new ComparisonValidationError(
          "threshold: нужна граница min и/или max",
        );
      if (
        spec.min !== undefined &&
        spec.max !== undefined &&
        spec.min > spec.max
      )
        throw new ComparisonValidationError("threshold: min больше max");
      return spec;
    }
    default:
      throw new ComparisonValidationError(
        `неподдерживаемый вид сравнения: ${value.kind}`,
      );
  }
}
