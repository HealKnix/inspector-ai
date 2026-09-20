import { normalizeTerm } from "./block-search.js";
import {
  COMPARISON_ENGINE_VERSION,
  type ComparisonSpec,
} from "./comparison-contract.js";
import { normalizeUnit } from "./extraction-engine.js";

// Member shape mirrors the JSON stored in evidence_groups.members.
export interface GroupMember {
  extraction_id: string;
  file_id: string;
  stage: string | null;
  role: "expected" | "actual" | "unknown";
  status: string;
  value: number | string | null;
  value_raw: string | null;
  unit: string | null;
}

export type PairResult = "match" | "mismatch" | "not_comparable";

export interface ComparisonPair {
  expected_extraction_id: string | null;
  actual_extraction_id: string | null;
  result: PairResult;
  delta: number | null;
  delta_pct: number | null;
  detail: string | null;
}

export interface MemberRef {
  extraction_id: string;
  file_id: string;
  value: number | string;
  value_raw: string | null;
  unit: string | null;
}

export type VerdictStatus =
  | "match"
  | "discrepancy"
  | "expected_missing"
  | "actual_missing"
  | "expected_ambiguous"
  | "actual_ambiguous"
  | "not_comparable"
  | "no_comparison";

export interface GroupVerdict {
  engine: string;
  status: VerdictStatus;
  spec: ComparisonSpec | null;
  expected: MemberRef[] | null;
  actual: MemberRef[] | null;
  pairs: ComparisonPair[];
  warnings: string[];
  evaluated_at: string;
}

const EPSILON = 1e-9;

function memberRef(member: GroupMember): MemberRef {
  return {
    extraction_id: member.extraction_id,
    file_id: member.file_id,
    value: member.value as number | string,
    value_raw: member.value_raw,
    unit: member.unit,
  };
}

/** Distinct extracted values of one role; same normalized value+unit dedupes. */
function distinctExtracted(
  members: GroupMember[],
  role: "expected" | "actual",
) {
  const seen = new Map<string, GroupMember[]>();
  for (const member of members) {
    if (member.role !== role || member.status !== "extracted") continue;
    const value = member.value;
    if (value === null || value === undefined) continue;
    const key =
      typeof value === "number"
        ? `n:${value}:${normalizeUnit(member.unit) ?? ""}`
        : `s:${normalizeTerm(String(value))}:${normalizeUnit(member.unit) ?? ""}`;
    const list = seen.get(key) ?? [];
    list.push(member);
    seen.set(key, list);
  }
  return [...seen.values()].map((list) => list[0]!);
}

function numeric(member: GroupMember): number | null {
  return typeof member.value === "number" && Number.isFinite(member.value)
    ? member.value
    : null;
}

function unitsCompatible(
  expected: GroupMember,
  actual: GroupMember,
): { ok: boolean; warning: string | null } {
  const expectedUnit = normalizeUnit(expected.unit);
  const actualUnit = normalizeUnit(actual.unit);
  if (expectedUnit && actualUnit && expectedUnit !== actualUnit)
    return { ok: false, warning: null };
  if (!expectedUnit !== !actualUnit)
    return { ok: true, warning: "unit_missing" };
  return { ok: true, warning: null };
}

function comparePair(
  spec: Exclude<ComparisonSpec, { kind: "threshold" }>,
  expected: GroupMember,
  actual: GroupMember,
): ComparisonPair {
  const pair: ComparisonPair = {
    expected_extraction_id: expected.extraction_id,
    actual_extraction_id: actual.extraction_id,
    result: "not_comparable",
    delta: null,
    delta_pct: null,
    detail: null,
  };
  const units = unitsCompatible(expected, actual);
  if (!units.ok) {
    pair.detail = "unit_mismatch";
    return pair;
  }
  if (units.warning) pair.detail = units.warning;
  const expectedNumber = numeric(expected);
  const actualNumber = numeric(actual);
  if (spec.kind === "equals") {
    if (expectedNumber !== null && actualNumber !== null) {
      pair.delta = Math.abs(actualNumber - expectedNumber);
      pair.result = pair.delta <= EPSILON ? "match" : "mismatch";
      return pair;
    }
    if ((expectedNumber !== null) !== (actualNumber !== null)) {
      pair.detail = "type_mismatch";
      return pair;
    }
    pair.result =
      normalizeTerm(String(expected.value)) ===
      normalizeTerm(String(actual.value))
        ? "match"
        : "mismatch";
    return pair;
  }
  // Ordered/delta specs are numeric-only.
  if (expectedNumber === null || actualNumber === null) {
    pair.detail = "non_numeric";
    return pair;
  }
  const delta = actualNumber - expectedNumber;
  pair.delta = delta;
  pair.delta_pct =
    Math.abs(expectedNumber) > EPSILON
      ? (Math.abs(delta) / Math.abs(expectedNumber)) * 100
      : null;
  switch (spec.kind) {
    case "numeric_delta": {
      const bound = Math.max(
        spec.tolerance_abs ?? 0,
        ((spec.tolerance_pct ?? 0) / 100) * Math.abs(expectedNumber),
      );
      pair.result = Math.abs(delta) <= bound + EPSILON ? "match" : "mismatch";
      return pair;
    }
    case "no_decrease":
      pair.result =
        actualNumber >= expectedNumber - EPSILON ? "match" : "mismatch";
      return pair;
    case "no_increase":
      pair.result =
        actualNumber <= expectedNumber + EPSILON ? "match" : "mismatch";
      return pair;
  }
}

function thresholdPair(
  spec: { min?: number; max?: number },
  member: GroupMember,
): ComparisonPair {
  const pair: ComparisonPair = {
    expected_extraction_id:
      member.role === "expected" ? member.extraction_id : null,
    actual_extraction_id:
      member.role === "actual" ? member.extraction_id : null,
    result: "not_comparable",
    delta: null,
    delta_pct: null,
    detail: null,
  };
  const value = numeric(member);
  if (value === null) {
    pair.detail = "non_numeric";
    return pair;
  }
  if (spec.min !== undefined && value < spec.min - EPSILON) {
    pair.result = "mismatch";
    pair.detail = `below_min:${spec.min}`;
    return pair;
  }
  if (spec.max !== undefined && value > spec.max + EPSILON) {
    pair.result = "mismatch";
    pair.detail = `above_max:${spec.max}`;
    return pair;
  }
  pair.result = "match";
  return pair;
}

function rollup(pairs: ComparisonPair[]): VerdictStatus {
  if (pairs.some((pair) => pair.result === "mismatch")) return "discrepancy";
  if (pairs.length > 0 && pairs.every((pair) => pair.result === "match"))
    return "match";
  return "not_comparable";
}

/**
 * Verdict over grouped extractions. Expected side = PD members, actual =
 * RD/ID; each side participates only with status "extracted". A missing or
 * ambiguous side is an explicit outcome, never a violation.
 */
export function evaluateGroup(
  members: GroupMember[],
  spec: ComparisonSpec | null,
  evaluatedAt = new Date(),
): GroupVerdict {
  const base: GroupVerdict = {
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
    base.warnings.push("unclassified_members");
  if (!spec) return base;

  const expected = distinctExtracted(members, "expected");
  const actual = distinctExtracted(members, "actual");
  if (expected.length > 1) {
    base.status = "expected_ambiguous";
    base.expected = expected.map(memberRef);
    return base;
  }
  if (expected.length === 0) {
    base.status = "expected_missing";
    return base;
  }
  base.expected = expected.map(memberRef);
  if (actual.length > 1) {
    base.status = "actual_ambiguous";
    base.actual = actual.map(memberRef);
    return base;
  }
  if (actual.length === 0) {
    base.status = "actual_missing";
    return base;
  }
  base.actual = actual.map(memberRef);

  if (spec.kind === "threshold") {
    // A normative bound applies to every extracted value on its own —
    // a project value violating the norm is a discrepancy even when the
    // actual side is absent or equal.
    const membersToCheck = [...expected, ...actual];
    base.pairs = membersToCheck.map((member) => thresholdPair(spec, member));
    base.status = rollup(base.pairs);
    return base;
  }

  const warnings = new Set<string>();
  base.pairs = actual.map((actualMember) => {
    const pair = comparePair(spec, expected[0]!, actualMember);
    if (pair.detail === "unit_missing") warnings.add("unit_missing");
    return pair;
  });
  base.warnings.push(...warnings);
  base.status = rollup(base.pairs);
  return base;
}
