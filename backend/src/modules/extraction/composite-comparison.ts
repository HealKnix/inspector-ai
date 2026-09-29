import { createHash } from "node:crypto";
import { canonicalJson } from "../documents/canonical-json.js";
import {
  COMPARISON_ENGINE_VERSION,
  COMPOSITE_ENGINE_VERSION,
  validateComparisonSpec,
  type CompositeComparisonSpec,
  type CompositeNode,
  type LeafComparisonSpec,
} from "./comparison-contract.js";
import type { GroupMember, GroupVerdict } from "./comparison-engine.js";

export type CompositeTruth = "true" | "false" | "unknown";
export type CompositeApplicability =
  "applicable" | "not_applicable" | "unknown";
export interface CompositeContextBinding {
  context_id: string;
  scope_key: string;
  period_key: string | null;
}
export interface CompositeEvaluationContext extends CompositeContextBinding {
  reference: { document_id: string; revision_id: string } | null;
  actual: { document_id: string; revision_id: string } | null;
  applicability: CompositeApplicability;
  applicability_basis: string | null;
}
export interface CompositeSource {
  extraction_id: string;
  file_id: string;
  artifact_id: string | null;
  document_id: string | null;
  revision_id: string | null;
  evidence: unknown[];
}
export interface CompositeBranchTrace {
  id: string;
  kind: "and" | "or" | "scalar";
  result: CompositeTruth;
  applicability: CompositeApplicability;
  evaluated: boolean;
  reasons: string[];
  determining_branch_ids: string[];
  children: CompositeBranchTrace[];
  scalar: GroupVerdict | null;
  sources: CompositeSource[];
}
export interface CompositeComparisonTrace {
  schema_version: 1;
  kind: "composite";
  engine: typeof COMPOSITE_ENGINE_VERSION;
  result: CompositeTruth;
  applicability: CompositeApplicability;
  context: CompositeEvaluationContext | null;
  resolved_input_hash: string;
  root: CompositeBranchTrace;
}

/** Carryover includes the decisions and applicability the inspector saw, while
 * source content/locators are fingerprinted by the existing member projection.
 * Per-run IDs and timestamps must not invalidate an unchanged decision. */
export function compositeSemanticBasis(trace: CompositeComparisonTrace) {
  function branch(node: CompositeBranchTrace): unknown {
    return {
      id: node.id,
      kind: node.kind,
      result: node.result,
      applicability: node.applicability,
      evaluated: node.evaluated,
      reasons: node.reasons,
      determining_branch_ids: node.determining_branch_ids,
      children: node.children.map(branch),
      scalar: node.scalar
        ? {
            engine: node.scalar.engine,
            status: node.scalar.status,
            warnings: node.scalar.warnings,
            pairs: node.scalar.pairs.map((pair) => ({
              result: pair.result,
              delta: pair.delta,
              delta_pct: pair.delta_pct,
              detail: pair.detail,
            })),
          }
        : null,
    };
  }
  return {
    schema_version: trace.schema_version,
    engine: trace.engine,
    result: trace.result,
    applicability: trace.applicability,
    context: trace.context,
    root: branch(trace.root),
  };
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= 2000
  );
}
export function validCompositeBinding(
  value: unknown,
): value is CompositeContextBinding {
  return (
    object(value) &&
    Object.keys(value).length === 3 &&
    text(value.context_id) &&
    text(value.scope_key) &&
    (value.period_key === null || text(value.period_key))
  );
}
export function validateCompositeContext(
  value: unknown,
): CompositeEvaluationContext {
  if (
    !object(value) ||
    Object.keys(value).length !== 7 ||
    !validCompositeBinding({
      context_id: value.context_id,
      scope_key: value.scope_key,
      period_key: value.period_key,
    }) ||
    !["applicable", "not_applicable", "unknown"].includes(
      String(value.applicability),
    ) ||
    !(value.applicability_basis === null || text(value.applicability_basis))
  )
    throw new Error("composite_context_invalid");
  for (const key of ["reference", "actual"] as const) {
    const ref = value[key];
    if (
      ref !== null &&
      (!object(ref) ||
        Object.keys(ref).length !== 2 ||
        !text(ref.document_id) ||
        !text(ref.revision_id))
    )
      throw new Error("composite_context_invalid");
  }
  if (value.applicability !== "unknown" && !text(value.applicability_basis))
    throw new Error("composite_applicability_basis_missing");
  return value as unknown as CompositeEvaluationContext;
}

/** Technical strong-Kleene truth table; never a decision by an inspector. */
export function compositeTruth(
  kind: "and" | "or",
  values: CompositeTruth[],
): CompositeTruth {
  if (!values.length) return "unknown";
  if (kind === "and") {
    if (values.includes("false")) return "false";
    return values.every((value) => value === "true") ? "true" : "unknown";
  }
  if (values.includes("true")) return "true";
  return values.every((value) => value === "false") ? "false" : "unknown";
}

function contextProblems(
  members: GroupMember[],
  context: CompositeEvaluationContext | null,
): string[] {
  if (!context) return ["composite_context_missing"];
  const problems: string[] = [];
  if (context.applicability !== "applicable")
    problems.push(`composite_applicability_${context.applicability}`);
  for (const member of members) {
    if (member.role === "unknown") {
      problems.push("composite_member_role_unknown");
      continue;
    }
    const ref = member.role === "expected" ? context.reference : context.actual;
    const binding = member.comparison_context;
    if (!validCompositeBinding(binding))
      problems.push("composite_member_context_missing");
    else if (
      binding.context_id !== context.context_id ||
      binding.scope_key !== context.scope_key ||
      binding.period_key !== context.period_key
    )
      problems.push("composite_member_context_mismatch");
    if (
      !ref ||
      member.document_id !== ref.document_id ||
      member.revision_id !== ref.revision_id
    )
      problems.push("composite_revision_mismatch");
  }
  return [...new Set(problems)];
}

/** All leaves intentionally consume one already resolved EvidenceGroup. This
 * adapter does not implement multi-quantity operands, presence or geometry. */
export function evaluateCompositeGroup(
  members: GroupMember[],
  inputSpec: CompositeComparisonSpec,
  evaluatedAt: Date,
  inputContext: CompositeEvaluationContext | undefined,
  scalarEvaluator: (
    members: GroupMember[],
    spec: LeafComparisonSpec,
    at: Date,
  ) => GroupVerdict,
): GroupVerdict {
  // Runtime guard also protects in-process callers against cyclic/unbounded input.
  const spec = validateComparisonSpec(inputSpec) as CompositeComparisonSpec;
  let context: CompositeEvaluationContext | null = null;
  const validationProblems: string[] = [];
  if (inputContext !== undefined) {
    try {
      context = validateCompositeContext(inputContext);
    } catch (error) {
      validationProblems.push(
        error instanceof Error ? error.message : "composite_context_invalid",
      );
    }
  }
  const blockers = [
    ...new Set([...validationProblems, ...contextProblems(members, context)]),
  ];
  const applicability = context?.applicability ?? "unknown";
  const sources: CompositeSource[] = members.map((member) => ({
    extraction_id: member.extraction_id,
    file_id: member.file_id,
    artifact_id: member.artifact_id ?? null,
    document_id: member.document_id ?? null,
    revision_id: member.revision_id ?? null,
    evidence: member.evidence ?? [],
  }));
  function visit(node: CompositeNode): CompositeBranchTrace {
    const trace: CompositeBranchTrace = {
      id: node.id,
      kind: node.kind,
      result: "unknown",
      applicability,
      evaluated: blockers.length === 0,
      reasons: [...blockers],
      determining_branch_ids: [],
      children: [],
      scalar: null,
      sources: [],
    };
    if (node.kind === "scalar") {
      trace.sources = sources;
      if (blockers.length) return trace;
      // Legacy scalar evaluation may normalize members in place. Each branch
      // receives its own snapshot so branch order cannot change another result.
      const scalar = scalarEvaluator(
        structuredClone(members),
        node.comparison,
        evaluatedAt,
      );
      trace.scalar = scalar;
      trace.result =
        scalar.status === "match"
          ? "true"
          : scalar.status === "discrepancy"
            ? "false"
            : "unknown";
      trace.reasons = [
        ...new Set([
          ...scalar.warnings,
          ...scalar.pairs.flatMap((pair) => (pair.detail ? [pair.detail] : [])),
          ...(trace.result === "unknown" ? [`scalar_${scalar.status}`] : []),
        ]),
      ];
      if (trace.result !== "unknown") trace.determining_branch_ids = [node.id];
      return trace;
    }
    // Evaluate all children, including branches that do not determine the result.
    trace.children = node.children.map(visit);
    if (blockers.length) return trace;
    trace.result = compositeTruth(
      node.kind,
      trace.children.map((child) => child.result),
    );
    const determining = trace.children.filter((child) =>
      trace.result === "unknown"
        ? child.result === "unknown"
        : node.kind === "and" && trace.result === "false"
          ? child.result === "false"
          : node.kind === "or" && trace.result === "true"
            ? child.result === "true"
            : true,
    );
    trace.determining_branch_ids = determining.map((child) => child.id);
    trace.reasons =
      trace.result === "unknown" ? ["composite_branch_unknown"] : [];
    return trace;
  }
  const root = visit(spec.root);
  const composite: CompositeComparisonTrace = {
    schema_version: 1,
    kind: "composite",
    engine: COMPOSITE_ENGINE_VERSION,
    result: root.result,
    applicability,
    context,
    resolved_input_hash: createHash("sha256")
      .update(canonicalJson({ members, context, spec }))
      .digest("hex"),
    root,
  };
  return {
    engine: COMPARISON_ENGINE_VERSION,
    spec,
    status:
      root.result === "true"
        ? "match"
        : root.result === "false"
          ? "discrepancy"
          : "not_comparable",
    expected: null,
    actual: null,
    pairs: [],
    warnings: blockers,
    evaluated_at: evaluatedAt.toISOString(),
    composite,
  };
}
