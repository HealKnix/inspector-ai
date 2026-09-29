import {
  COMPARISON_ENGINE_VERSION,
  type OrderedCategorySpec,
  type ScalarComparisonSpec,
} from "./comparison-contract.js";
import type {
  ComparisonPair,
  GroupMember,
  GroupVerdict,
  MemberRef,
  PairResult,
} from "./comparison-engine.js";
import {
  decimalCompare as compare,
  decimal,
  decimalAbs,
  decimalLiteral,
  decimalMax,
  decimalMin,
  decimalMultiply,
  decimalRound,
  decimalShift,
  decimalSubtract,
  decimalText,
  normalizeDecimalInput,
  type Decimal,
} from "./exact-decimal.js";
import {
  UNIT_CONVERSION_VERSION,
  unitDefinition,
  validateNumericalEvidence,
  type NumericalEvidence,
  type NumericalPolicy,
} from "./numerical-policy.js";

export interface NumericalSideTrace {
  extraction_id: string;
  raw: string | null;
  decimal: string;
  source_unit: NumericalEvidence["unit"];
  uncertainty: NumericalEvidence["uncertainty"];
  converted: string;
  conversion: { from: string; to: string; factor: string; exponent: number };
  rounded: string;
  interval: { lower: string; upper: string };
  evidence: unknown[];
}
export interface NumericalComparisonTrace {
  schema_version: 1;
  kind: "numerical";
  policy: NumericalPolicy;
  conversion_version: typeof UNIT_CONVERSION_VERSION;
  expected: NumericalSideTrace | null;
  actual: NumericalSideTrace | null;
  delta: string | null;
  relative_delta: { numerator: string; denominator: string } | null;
  bounds: Record<string, string | boolean | null>;
  reason: string | null;
}
export interface CategoryComparisonTrace {
  schema_version: 1;
  kind: "ordered_category";
  map_version: string;
  basis: OrderedCategorySpec["basis"];
  direction: OrderedCategorySpec["direction"];
  expected: {
    raw: string | null;
    category: string;
    rank: number | null;
    evidence: unknown[];
  };
  actual: {
    raw: string | null;
    category: string;
    rank: number | null;
    evidence: unknown[];
  };
  reason: string | null;
}
type Prepared = {
  point: Decimal;
  lower: Decimal;
  upper: Decimal;
  trace: NumericalSideTrace;
};
const ZERO = decimal("0");
function prepare(member: GroupMember, policy: NumericalPolicy): Prepared {
  if (!member.numerical) throw new Error("numerical_evidence_missing");
  const evidence = validateNumericalEvidence(member.numerical);
  if (normalizeDecimalInput(String(member.value)) !== evidence.decimal)
    throw new Error("numerical_value_evidence_mismatch");
  const target = unitDefinition(policy.target_unit)!;
  let source = unitDefinition(evidence.unit.canonical);
  if (evidence.unit.source === "missing") {
    if (policy.target_unit !== "1") throw new Error("unit_missing");
    source = unitDefinition("1");
  }
  if (!source || !target || source.dimension !== target.dimension)
    throw new Error("unit_dimension_mismatch");
  if (
    source.dimension === "ratio" &&
    source.canonical !== target.canonical &&
    !policy.allow_percent_fraction
  )
    throw new Error("percent_fraction_not_authorized");
  // A declared side unit cannot contradict its located numerical evidence.
  if (
    member.unit !== null &&
    unitDefinition(member.unit)?.canonical !== source.canonical
  )
    throw new Error("unit_evidence_mismatch");
  const exponent = source.exponent - target.exponent;
  const converted = decimalShift(decimal(evidence.decimal), exponent);
  const convert = (text: string) => decimalShift(decimal(text), exponent);
  const round = (value: Decimal) =>
    policy.rounding
      ? decimalRound(value, policy.rounding.scale, policy.rounding.mode)
      : value;
  const point = round(converted),
    lower = round(convert(evidence.uncertainty?.lower ?? evidence.decimal)),
    upper = round(convert(evidence.uncertainty?.upper ?? evidence.decimal));
  return {
    point,
    lower,
    upper,
    trace: {
      extraction_id: member.extraction_id,
      raw: member.value_raw,
      decimal: evidence.decimal,
      source_unit: evidence.unit,
      uncertainty: evidence.uncertainty,
      converted: decimalText(converted),
      conversion: {
        from: source.canonical,
        to: target.canonical,
        factor: decimalText(decimalShift(decimal("1"), exponent)),
        exponent,
      },
      rounded: decimalText(point),
      interval: { lower: decimalText(lower), upper: decimalText(upper) },
      evidence: member.evidence ?? [],
    },
  };
}
function basePair(
  expected: GroupMember | null,
  actual: GroupMember | null,
): ComparisonPair {
  return {
    expected_extraction_id: expected?.extraction_id ?? null,
    actual_extraction_id: actual?.extraction_id ?? null,
    result: "not_comparable",
    delta: null,
    delta_pct: null,
    detail: null,
  };
}
function display(value: Decimal): number | null {
  const result = Number(decimalText(value));
  return Number.isFinite(result) ? result : null;
}
function singleton(value: Prepared) {
  return compare(value.lower, value.upper) === 0;
}
function absRange(lower: Decimal, upper: Decimal): [Decimal, Decimal] {
  return [
    compare(lower, ZERO) <= 0 && compare(upper, ZERO) >= 0
      ? ZERO
      : decimalMin(decimalAbs(lower), decimalAbs(upper)),
    decimalMax(decimalAbs(lower), decimalAbs(upper)),
  ];
}
function numericalPair(
  spec: ScalarComparisonSpec,
  expected: GroupMember | null,
  actual: GroupMember | null,
): ComparisonPair {
  const policy = spec.numerical_policy!;
  const pair = basePair(expected, actual);
  const trace: NumericalComparisonTrace = {
    schema_version: 1,
    kind: "numerical",
    policy,
    conversion_version: UNIT_CONVERSION_VERSION,
    expected: null,
    actual: null,
    delta: null,
    relative_delta: null,
    bounds: {},
    reason: null,
  };
  pair.trace = trace;
  try {
    const e = expected ? prepare(expected, policy) : null;
    trace.expected = e?.trace ?? null;
    const a = actual ? prepare(actual, policy) : null;
    trace.actual = a?.trace ?? null;
    if (spec.kind === "threshold") {
      const value = a ?? e;
      if (!value) throw new Error("numerical_value_missing");
      let always = true,
        never = false;
      for (const edge of ["min", "max"] as const) {
        if (spec[edge] === undefined) continue;
        const limit = decimalLiteral(spec[edge]);
        const inclusive = spec[`${edge}_inclusive`];
        if (typeof inclusive !== "boolean")
          throw new Error("numerical_boundary_missing");
        trace.bounds[edge] = decimalText(limit);
        trace.bounds[`${edge}_inclusive`] = inclusive;
        const l = compare(value.lower, limit),
          u = compare(value.upper, limit);
        if (edge === "min") {
          always &&= inclusive ? l >= 0 : l > 0;
          never ||= inclusive ? u < 0 : u <= 0;
        } else {
          always &&= inclusive ? u <= 0 : u < 0;
          never ||= inclusive ? l > 0 : l >= 0;
        }
      }
      pair.result = always ? "match" : never ? "mismatch" : "not_comparable";
    } else {
      if (!e || !a) throw new Error("numerical_pair_missing");
      const delta = decimalSubtract(a.point, e.point);
      trace.delta = decimalText(delta);
      pair.delta = display(delta);
      if (compare(e.point, ZERO) !== 0) {
        const numerator = decimalShift(decimalAbs(delta), 2),
          denominator = decimalAbs(e.point);
        trace.relative_delta = {
          numerator: decimalText(numerator),
          denominator: decimalText(denominator),
        };
        const shown =
          Number(decimalText(numerator)) / Number(decimalText(denominator));
        pair.delta_pct = Number.isFinite(shown) ? shown : null;
      }
      if (spec.kind === "equals")
        pair.result =
          singleton(e) && singleton(a) && compare(e.point, a.point) === 0
            ? "match"
            : compare(a.upper, e.lower) < 0 || compare(a.lower, e.upper) > 0
              ? "mismatch"
              : "not_comparable";
      if (spec.kind === "no_decrease")
        pair.result =
          compare(a.lower, e.upper) >= 0
            ? "match"
            : compare(a.upper, e.lower) < 0
              ? "mismatch"
              : "not_comparable";
      if (spec.kind === "no_increase")
        pair.result =
          compare(a.upper, e.lower) <= 0
            ? "match"
            : compare(a.lower, e.upper) > 0
              ? "mismatch"
              : "not_comparable";
      if (spec.kind === "numeric_delta") {
        if (typeof spec.inclusive !== "boolean")
          throw new Error("numerical_boundary_missing");
        const absolute = decimalLiteral(spec.tolerance_abs ?? 0);
        const percentage =
          spec.tolerance_pct === undefined
            ? null
            : decimalShift(decimalLiteral(spec.tolerance_pct), -2);
        const [expectedMin, expectedMax] = absRange(e.lower, e.upper);
        if (percentage && compare(expectedMin, ZERO) === 0) {
          if (policy.zero_expected === "not_comparable")
            throw new Error("zero_expected_not_comparable");
          if (spec.tolerance_abs === undefined)
            throw new Error("zero_expected_absolute_tolerance_missing");
        }
        const boundLow = percentage
          ? decimalMax(absolute, decimalMultiply(percentage, expectedMin))
          : absolute;
        const boundHigh = percentage
          ? decimalMax(absolute, decimalMultiply(percentage, expectedMax))
          : absolute;
        const [differenceMin, differenceMax] = absRange(
          decimalSubtract(a.lower, e.upper),
          decimalSubtract(a.upper, e.lower),
        );
        trace.bounds = {
          tolerance_abs:
            spec.tolerance_abs === undefined ? null : decimalText(absolute),
          tolerance_pct:
            spec.tolerance_pct === undefined
              ? null
              : decimalText(decimalLiteral(spec.tolerance_pct)),
          inclusive: spec.inclusive,
          effective_lower: decimalText(boundLow),
          effective_upper: decimalText(boundHigh),
        };
        const within = compare(differenceMax, boundLow),
          outside = compare(differenceMin, boundHigh);
        pair.result = (spec.inclusive ? within <= 0 : within < 0)
          ? "match"
          : (spec.inclusive ? outside > 0 : outside >= 0)
            ? "mismatch"
            : "not_comparable";
      }
    }
    if (pair.result === "not_comparable")
      pair.detail = "uncertainty_crosses_boundary";
  } catch (error) {
    pair.detail =
      error instanceof Error ? error.message : "numerical_comparison_invalid";
  }
  trace.reason = pair.detail;
  return pair;
}
function categoryPair(
  spec: OrderedCategorySpec,
  expected: GroupMember,
  actual: GroupMember,
): ComparisonPair {
  const pair = basePair(expected, actual);
  const label = (member: GroupMember) =>
    typeof member.value === "string"
      ? member.value.normalize("NFC").trim()
      : "";
  const e = label(expected),
    a = label(actual);
  const rank = (name: string) =>
    Object.hasOwn(spec.ranks, name) ? spec.ranks[name]! : null;
  const er = rank(e),
    ar = rank(a);
  const trace: CategoryComparisonTrace = {
    schema_version: 1,
    kind: "ordered_category",
    map_version: spec.map_version,
    basis: spec.basis,
    direction: spec.direction,
    expected: {
      raw: expected.value_raw,
      category: e,
      rank: er,
      evidence: expected.evidence ?? [],
    },
    actual: {
      raw: actual.value_raw,
      category: a,
      rank: ar,
      evidence: actual.evidence ?? [],
    },
    reason: null,
  };
  pair.trace = trace;
  if (er === null || ar === null) pair.detail = "category_not_in_rank_map";
  else
    pair.result = (spec.direction === "no_decrease" ? ar >= er : ar <= er)
      ? "match"
      : "mismatch";
  trace.reason = pair.detail;
  return pair;
}
function ref(member: GroupMember): MemberRef {
  return {
    extraction_id: member.extraction_id,
    file_id: member.file_id,
    value: member.value!,
    value_raw: member.value_raw,
    unit: member.unit,
  };
}
function distinct(
  members: GroupMember[],
  role: "expected" | "actual",
  spec: ScalarComparisonSpec | OrderedCategorySpec,
): GroupMember[] {
  const result = new Map<string, GroupMember>();
  for (const member of members) {
    if (
      member.role !== role ||
      member.status !== "extracted" ||
      member.value === null
    )
      continue;
    let key = JSON.stringify([
      typeof member.value,
      member.value,
      member.unit,
      member.numerical ?? null,
    ]);
    if (spec.kind !== "ordered_category" && spec.numerical_policy) {
      try {
        const value = prepare(member, spec.numerical_policy);
        key = JSON.stringify([
          decimalText(value.point),
          decimalText(value.lower),
          decimalText(value.upper),
          spec.numerical_policy.target_unit,
        ]);
      } catch {
        /* Incomplete evidence stays distinct; never borrow another unit. */
      }
    }
    if (!result.has(key)) result.set(key, member);
  }
  return [...result.values()];
}
export function evaluateExactGroup(
  members: GroupMember[],
  spec: ScalarComparisonSpec | OrderedCategorySpec,
  evaluatedAt: Date,
): GroupVerdict {
  const result: GroupVerdict = {
    engine: COMPARISON_ENGINE_VERSION,
    status: "no_comparison",
    spec,
    expected: null,
    actual: null,
    pairs: [],
    warnings: [],
    evaluated_at: evaluatedAt.toISOString(),
  };
  if (members.some((member) => member.role === "unknown"))
    result.warnings.push("unclassified_members");
  const expected = distinct(members, "expected", spec),
    actual = distinct(members, "actual", spec);
  result.expected = expected.length ? expected.map(ref) : null;
  result.actual = actual.length ? actual.map(ref) : null;
  for (const role of ["expected", "actual"] as const) {
    if (
      (role === "expected" ? expected : actual).length > 1 ||
      members.some(
        (member) => member.role === role && member.status === "ambiguous",
      )
    ) {
      result.status = `${role}_ambiguous`;
      return result;
    }
  }
  if (spec.kind === "threshold") {
    if (!expected.length && !actual.length) {
      result.status = "expected_missing";
      return result;
    }
    result.pairs = [
      ...expected.map((member) => numericalPair(spec, member, null)),
      ...actual.map((member) => numericalPair(spec, null, member)),
    ];
  } else {
    if (!expected.length) {
      result.status = "expected_missing";
      return result;
    }
    if (!actual.length) {
      result.status = "actual_missing";
      return result;
    }
    result.pairs = [
      spec.kind === "ordered_category"
        ? categoryPair(spec, expected[0]!, actual[0]!)
        : numericalPair(spec, expected[0]!, actual[0]!),
    ];
  }
  const outcomes: PairResult[] = result.pairs.map((pair) => pair.result);
  result.status = outcomes.includes("mismatch")
    ? "discrepancy"
    : outcomes.every((value) => value === "match")
      ? "match"
      : "not_comparable";
  return result;
}
