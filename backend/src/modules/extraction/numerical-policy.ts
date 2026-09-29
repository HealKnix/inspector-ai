import {
  decimal,
  decimalCompare,
  decimalLiteral,
  decimalText,
  type RoundingMode,
} from "./exact-decimal.js";
import type { EvidenceLocator } from "./extraction-contract.js";

export const NUMERICAL_POLICY_VERSION = "decimal-units-v1";
export const UNIT_CONVERSION_VERSION = "metric-units-v1";
export interface NumericalPolicy {
  version: typeof NUMERICAL_POLICY_VERSION;
  target_unit: string;
  zero_expected: "absolute_only" | "not_comparable";
  allow_percent_fraction: boolean;
  rounding: { scale: number; mode: RoundingMode } | null;
}
export interface NumericalBasis {
  reference: string;
  version: string;
  locator: string;
}
export interface NumericalEvidence {
  schema_version: 1;
  decimal: string;
  unit: {
    raw: string | null;
    canonical: string | null;
    dimension: string | null;
    source: "value" | "row" | "header" | "missing";
    evidence: EvidenceLocator[];
  };
  uncertainty: { lower: string; upper: string; basis: NumericalBasis } | null;
}
export interface NumberPolicy {
  version: "decimal-v1";
  mode: "single" | "first";
  reject_list_marker: boolean;
  require_unit: boolean;
}
export interface UnitDefinition {
  canonical: string;
  dimension: string;
  exponent: number;
}
const units = new Map<string, UnitDefinition>();
function unit(
  canonical: string,
  dimension: string,
  exponent: number,
  aliases: string[] = [],
) {
  const value = { canonical, dimension, exponent };
  for (const alias of [canonical, ...aliases])
    units.set(alias.toLowerCase().replace(/\s+/g, ""), value);
}
for (const [name, exponent, ru] of [
  ["mm", -3, "мм"],
  ["cm", -2, "см"],
  ["m", 0, "м"],
  ["km", 3, "км"],
] as const) {
  unit(name, "length", exponent, [
    ru,
    ...(name === "m" ? ["п.м", "пог.м", "пог. м"] : []),
  ]);
  unit(`${name}2`, "area", exponent * 2, [
    `${ru}2`,
    `${ru}²`,
    `${name}²`,
    ...(name === "m" ? ["кв.м", "кв м"] : []),
  ]);
  unit(`${name}3`, "volume", exponent * 3, [
    `${ru}3`,
    `${ru}³`,
    `${name}³`,
    ...(name === "m" ? ["куб.м", "куб м"] : []),
  ]);
}
unit("g", "mass", -3, ["г"]);
unit("kg", "mass", 0, ["кг"]);
unit("t", "mass", 3, ["т"]);
unit("V", "voltage", 0, ["В"]);
unit("kV", "voltage", 3, ["кВ"]);
unit("pcs", "count", 0, ["шт", "шт.", "ед", "ед."]);
unit("1", "ratio", 0);
unit("%", "ratio", -2, ["процент", "процентов", "проц."]);
export function unitDefinition(raw: string | null): UnitDefinition | null {
  return raw === null
    ? null
    : (units.get(
        raw.normalize("NFC").trim().toLowerCase().replace(/\s+/g, ""),
      ) ?? null);
}
export function normalizedUnit(raw: string | null): string | null {
  if (!raw) return null;
  return (
    unitDefinition(raw)?.canonical ??
    raw.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim()
  );
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exactObject(
  value: unknown,
  keys: string[],
): asserts value is Record<string, unknown> {
  if (
    !record(value) ||
    Object.keys(value).length !== keys.length ||
    !Object.keys(value).every((key) => keys.includes(key))
  )
    throw new Error("numerical_invalid_fields");
}
export function validateNumericalBasis(value: unknown): NumericalBasis {
  exactObject(value, ["reference", "version", "locator"]);
  if (
    !Object.values(value).every(
      (item) =>
        typeof item === "string" &&
        item.trim().length > 0 &&
        item.length <= 2000,
    )
  )
    throw new Error("numerical_basis_required");
  return value as unknown as NumericalBasis;
}
export function validateNumericalPolicy(value: unknown): NumericalPolicy {
  exactObject(value, [
    "version",
    "target_unit",
    "zero_expected",
    "allow_percent_fraction",
    "rounding",
  ]);
  if (
    value.version !== NUMERICAL_POLICY_VERSION ||
    typeof value.target_unit !== "string" ||
    unitDefinition(value.target_unit)?.canonical !== value.target_unit ||
    !["absolute_only", "not_comparable"].includes(
      String(value.zero_expected),
    ) ||
    typeof value.allow_percent_fraction !== "boolean"
  )
    throw new Error("numerical_policy_invalid");
  if (value.rounding !== null) {
    exactObject(value.rounding, ["scale", "mode"]);
    if (
      !Number.isInteger(value.rounding.scale) ||
      Number(value.rounding.scale) < 0 ||
      Number(value.rounding.scale) > 30 ||
      !["half_up", "half_even", "toward_zero"].includes(
        String(value.rounding.mode),
      )
    )
      throw new Error("numerical_rounding_invalid");
  }
  return value as unknown as NumericalPolicy;
}
export function validateNumberPolicy(value: unknown): NumberPolicy {
  exactObject(value, ["version", "mode", "reject_list_marker", "require_unit"]);
  if (
    value.version !== "decimal-v1" ||
    !["single", "first"].includes(String(value.mode)) ||
    typeof value.reject_list_marker !== "boolean" ||
    typeof value.require_unit !== "boolean"
  )
    throw new Error("number_policy_invalid");
  return value as unknown as NumberPolicy;
}
export function validateNumericalEvidence(value: unknown): NumericalEvidence {
  exactObject(value, ["schema_version", "decimal", "unit", "uncertainty"]);
  if (
    value.schema_version !== 1 ||
    typeof value.decimal !== "string" ||
    decimalText(decimal(value.decimal)) !== value.decimal
  )
    throw new Error("numerical_value_invalid");
  exactObject(value.unit, [
    "raw",
    "canonical",
    "dimension",
    "source",
    "evidence",
  ]);
  const u = value.unit;
  if (!Array.isArray(u.evidence) || u.evidence.length > 100)
    throw new Error("numerical_unit_evidence_invalid");
  if (u.source === "missing") {
    if (
      u.raw !== null ||
      u.canonical !== null ||
      u.dimension !== null ||
      u.evidence.length
    )
      throw new Error("numerical_missing_unit_invalid");
  } else {
    if (
      !["value", "row", "header"].includes(String(u.source)) ||
      typeof u.raw !== "string" ||
      !u.raw.trim() ||
      !u.evidence.length
    )
      throw new Error("numerical_unit_origin_missing");
    const definition = unitDefinition(u.raw);
    if (
      !definition ||
      definition.canonical !== u.canonical ||
      definition.dimension !== u.dimension
    )
      throw new Error("numerical_unit_invalid");
    for (const locator of u.evidence) {
      const positioned =
        record(locator) &&
        ((typeof locator.structural_path === "string" &&
          locator.structural_path.trim().length > 0) ||
          (Array.isArray(locator.bbox) &&
            locator.bbox.length === 4 &&
            locator.bbox.every(
              (n) =>
                typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1,
            ) &&
            locator.bbox[0] < locator.bbox[2] &&
            locator.bbox[1] < locator.bbox[3]));
      if (
        !record(locator) ||
        !Number.isInteger(locator.page_number) ||
        Number(locator.page_number) < 1 ||
        typeof locator.quote !== "string" ||
        !locator.quote.trim() ||
        typeof locator.block_id !== "string" ||
        !locator.block_id ||
        !positioned
      )
        throw new Error("numerical_unit_locator_invalid");
    }
  }
  if (value.uncertainty !== null) {
    exactObject(value.uncertainty, ["lower", "upper", "basis"]);
    if (
      typeof value.uncertainty.lower !== "string" ||
      typeof value.uncertainty.upper !== "string"
    )
      throw new Error("numerical_uncertainty_invalid");
    const point = decimal(value.decimal),
      lower = decimal(value.uncertainty.lower),
      upper = decimal(value.uncertainty.upper);
    if (decimalCompare(lower, point) > 0 || decimalCompare(point, upper) > 0)
      throw new Error("numerical_uncertainty_invalid");
    validateNumericalBasis(value.uncertainty.basis);
  }
  return value as unknown as NumericalEvidence;
}
export function canonicalDecimalLiteral(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number")
    throw new Error("decimal_literal_invalid");
  return decimalText(decimalLiteral(value));
}
