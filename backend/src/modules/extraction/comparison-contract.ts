import { decimalCompare, decimalLiteral } from "./exact-decimal.js";
import {
  validateNumericalBasis,
  validateNumericalPolicy,
  type NumericalBasis,
  type NumericalPolicy,
} from "./numerical-policy.js";

export const COMPARISON_ENGINE_VERSION = "comparison-engine-v4";
export const COMPOSITE_ENGINE_VERSION = "composite-scalar-v1";
export const COMPOSITE_LIMITS = { depth: 6, nodes: 64, children: 8 } as const;
interface ScalarPolicy {
  numerical_policy?: NumericalPolicy;
}
export interface EqualsSpec extends ScalarPolicy {
  kind: "equals";
}
export interface NumericDeltaSpec extends ScalarPolicy {
  kind: "numeric_delta";
  tolerance_abs?: number | string;
  tolerance_pct?: number | string;
  inclusive?: boolean;
}
export interface NoDecreaseSpec extends ScalarPolicy {
  kind: "no_decrease";
}
export interface NoIncreaseSpec extends ScalarPolicy {
  kind: "no_increase";
}
export interface ThresholdSpec extends ScalarPolicy {
  kind: "threshold";
  min?: number | string;
  max?: number | string;
  min_inclusive?: boolean;
  max_inclusive?: boolean;
}
export interface OrderedCategorySpec {
  kind: "ordered_category";
  direction: "no_decrease" | "no_increase";
  map_version: string;
  ranks: Record<string, number>;
  basis: NumericalBasis;
}
export type ScalarComparisonSpec =
  | EqualsSpec
  | NumericDeltaSpec
  | NoDecreaseSpec
  | NoIncreaseSpec
  | ThresholdSpec;
export type LeafComparisonSpec = ScalarComparisonSpec | OrderedCategorySpec;
export type CompositeNode =
  | { id: string; kind: "and" | "or"; children: CompositeNode[] }
  | { id: string; kind: "scalar"; comparison: LeafComparisonSpec };
export interface CompositeComparisonSpec {
  kind: "composite";
  schema_version: 1;
  root: CompositeNode;
}
export type ComparisonSpec = LeafComparisonSpec | CompositeComparisonSpec;
export class ComparisonValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComparisonValidationError";
  }
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function fields(value: Record<string, unknown>, allowed: string[]) {
  if (!Object.keys(value).every((key) => allowed.includes(key)))
    throw new ComparisonValidationError(
      `${String(value.kind)}: неизвестное поле`,
    );
}
function bound(
  value: unknown,
  name: string,
  exact: boolean,
  nonnegative = false,
): number | string {
  if (exact) {
    if (typeof value !== "string" && typeof value !== "number")
      throw new ComparisonValidationError(`${name}: точное десятичное число`);
    try {
      const parsed = decimalLiteral(value);
      if (nonnegative && parsed.coefficient < 0n) throw new Error("negative");
    } catch {
      throw new ComparisonValidationError(
        `${name}: ограниченное ${nonnegative ? "неотрицательное " : ""}десятичное число`,
      );
    }
    return value;
  }
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (nonnegative && (value < 0 || value > 1e12))
  )
    throw new ComparisonValidationError(
      `${name}: ${nonnegative ? "неотрицательное число до 1e12" : "конечное число"}`,
    );
  return value;
}
export function validateComparisonSpec(value: unknown): ComparisonSpec {
  if (!record(value) || typeof value.kind !== "string")
    throw new ComparisonValidationError("comparison: объект с полем kind");
  if (value.kind === "composite") return validateCompositeSpec(value);
  let policy: NumericalPolicy | undefined;
  if (value.numerical_policy !== undefined) {
    try {
      policy = validateNumericalPolicy(value.numerical_policy);
    } catch (error) {
      throw new ComparisonValidationError(
        error instanceof Error ? error.message : "numerical_policy_invalid",
      );
    }
  }
  const withPolicy = policy ? { numerical_policy: policy } : {};
  switch (value.kind) {
    case "equals":
    case "no_decrease":
    case "no_increase":
      fields(value, ["kind", "numerical_policy"]);
      return { kind: value.kind, ...withPolicy };
    case "numeric_delta": {
      fields(value, [
        "kind",
        "tolerance_abs",
        "tolerance_pct",
        "numerical_policy",
        ...(policy ? ["inclusive"] : []),
      ]);
      const result: NumericDeltaSpec = { kind: "numeric_delta", ...withPolicy };
      if (value.tolerance_abs !== undefined)
        result.tolerance_abs = bound(
          value.tolerance_abs,
          "tolerance_abs",
          !!policy,
          true,
        );
      if (value.tolerance_pct !== undefined)
        result.tolerance_pct = bound(
          value.tolerance_pct,
          "tolerance_pct",
          !!policy,
          true,
        );
      if (
        result.tolerance_pct !== undefined &&
        decimalCompare(
          decimalLiteral(result.tolerance_pct),
          decimalLiteral(100),
        ) > 0
      )
        throw new ComparisonValidationError(
          "tolerance_pct: не больше 100 процентов",
        );
      if (policy) {
        if (
          typeof value.inclusive !== "boolean" ||
          (result.tolerance_abs === undefined &&
            result.tolerance_pct === undefined)
        )
          throw new ComparisonValidationError(
            "numeric_delta: нужны явные допуск и inclusive",
          );
        result.inclusive = value.inclusive;
      }
      return result;
    }
    case "threshold": {
      fields(value, [
        "kind",
        "min",
        "max",
        "numerical_policy",
        ...(policy ? ["min_inclusive", "max_inclusive"] : []),
      ]);
      const result: ThresholdSpec = { kind: "threshold", ...withPolicy };
      if (value.min !== undefined)
        result.min = bound(value.min, "min", !!policy);
      if (value.max !== undefined)
        result.max = bound(value.max, "max", !!policy);
      if (result.min === undefined && result.max === undefined)
        throw new ComparisonValidationError(
          "threshold: нужна граница min и/или max",
        );
      if (
        result.min !== undefined &&
        result.max !== undefined &&
        decimalCompare(decimalLiteral(result.min), decimalLiteral(result.max)) >
          0
      )
        throw new ComparisonValidationError("threshold: min больше max");
      if (policy)
        for (const edge of ["min", "max"] as const) {
          const key = `${edge}_inclusive` as const;
          if (result[edge] !== undefined) {
            if (typeof value[key] !== "boolean")
              throw new ComparisonValidationError(`threshold: нужен ${key}`);
            result[key] = value[key];
          } else if (value[key] !== undefined)
            throw new ComparisonValidationError(
              `threshold: ${key} без границы`,
            );
        }
      return result;
    }
    case "ordered_category": {
      fields(value, ["kind", "direction", "map_version", "ranks", "basis"]);
      if (
        !["no_decrease", "no_increase"].includes(String(value.direction)) ||
        typeof value.map_version !== "string" ||
        !value.map_version.trim() ||
        value.map_version.length > 128 ||
        !record(value.ranks) ||
        Object.keys(value.ranks).length < 2 ||
        Object.keys(value.ranks).length > 64 ||
        !Object.entries(value.ranks).every(
          ([label, rank]) =>
            label.trim() === label &&
            label.length > 0 &&
            label.length <= 128 &&
            typeof rank === "number" &&
            Number.isInteger(rank) &&
            Math.abs(rank) <= 1_000_000,
        )
      )
        throw new ComparisonValidationError(
          "ordered_category: нужны явные версия, направление и ограниченная карта рангов",
        );
      let basis: NumericalBasis;
      try {
        basis = validateNumericalBasis(value.basis);
      } catch {
        throw new ComparisonValidationError(
          "ordered_category: требуется основание",
        );
      }
      return {
        kind: "ordered_category",
        direction: value.direction as OrderedCategorySpec["direction"],
        map_version: value.map_version,
        ranks: { ...value.ranks } as Record<string, number>,
        basis,
      };
    }
    default:
      throw new ComparisonValidationError(
        `неподдерживаемый вид сравнения: ${value.kind}`,
      );
  }
}

function validateCompositeSpec(
  value: Record<string, unknown>,
): CompositeComparisonSpec {
  fields(value, ["kind", "schema_version", "root"]);
  if (value.schema_version !== 1)
    throw new ComparisonValidationError(
      "composite: неподдерживаемая schema_version",
    );
  const seen = new WeakSet<object>();
  const ids = new Set<string>();
  let count = 0;
  function visit(node: unknown, depth: number): CompositeNode {
    if (!record(node))
      throw new ComparisonValidationError(
        "composite: узел должен быть объектом",
      );
    if (seen.has(node))
      throw new ComparisonValidationError("composite: цикл или повтор узла");
    seen.add(node);
    if (++count > COMPOSITE_LIMITS.nodes || depth > COMPOSITE_LIMITS.depth)
      throw new ComparisonValidationError(
        "composite: превышен лимит узлов/глубины",
      );
    if (
      typeof node.id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(node.id) ||
      ids.has(node.id)
    )
      throw new ComparisonValidationError(
        "composite: нужен уникальный ограниченный id узла",
      );
    ids.add(node.id);
    if (node.kind === "and" || node.kind === "or") {
      fields(node, ["id", "kind", "children"]);
      if (
        !Array.isArray(node.children) ||
        node.children.length < 2 ||
        node.children.length > COMPOSITE_LIMITS.children
      )
        throw new ComparisonValidationError(
          "composite: нужно от 2 до 8 дочерних узлов",
        );
      return {
        id: node.id,
        kind: node.kind,
        children: node.children.map((child) => visit(child, depth + 1)),
      };
    }
    if (node.kind === "scalar") {
      fields(node, ["id", "kind", "comparison"]);
      if (record(node.comparison) && node.comparison.kind === "composite")
        throw new ComparisonValidationError(
          "composite: scalar не может содержать composite",
        );
      const comparison = validateComparisonSpec(node.comparison);
      if (comparison.kind === "composite")
        throw new ComparisonValidationError("composite: неверный лист");
      return { id: node.id, kind: "scalar", comparison };
    }
    throw new ComparisonValidationError(
      `composite: неподдерживаемый kind ${String(node.kind)}`,
    );
  }
  const root = visit(value.root, 1);
  if (root.kind === "scalar")
    throw new ComparisonValidationError("composite: корень должен быть AND/OR");
  return { kind: "composite", schema_version: 1, root };
}

export function comparisonLeaves(
  spec: ComparisonSpec,
): { id: string | null; comparison: LeafComparisonSpec }[] {
  if (spec.kind !== "composite") return [{ id: null, comparison: spec }];
  const leaves: { id: string; comparison: LeafComparisonSpec }[] = [];
  function visit(node: CompositeNode) {
    if (node.kind === "scalar")
      leaves.push({ id: node.id, comparison: node.comparison });
    else node.children.forEach(visit);
  }
  visit(spec.root);
  return leaves;
}
