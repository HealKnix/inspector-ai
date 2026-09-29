import { record, validateArtifact } from "../parsing/parsing-contract.js";
import {
  comparisonLeaves,
  validateComparisonSpec,
} from "./comparison-contract.js";
import { evaluateGroup, type GroupMember } from "./comparison-engine.js";
import type { CompositeBranchTrace } from "./composite-comparison.js";
import { validateExtractionPlan } from "./extraction-contract.js";
import { executePlan, normalizeUnit } from "./extraction-engine.js";
import {
  REGRESSION_CATEGORIES,
  regressionEngines,
  reviewedRuleHash,
  reviewHash,
  type RegressionFixture,
  type ReviewRule,
  type RulePassportContent,
} from "./matrix-review-contract.js";

/** Only executable operators are admitted. Scalar composite leaves share the
 * existing group; presence/geometry/event declarations still cannot pass. */
export function runRuleRegression(
  rule: ReviewRule,
  passport: RulePassportContent,
  fixtures: RegressionFixture[],
) {
  const plan = validateExtractionPlan(rule.plan);
  const comparison =
    rule.comparison === null ? null : validateComparisonSpec(rule.comparison);
  const blockers: string[] = [];
  if (!passport.quantity || !passport.applicability || !passport.scope)
    blockers.push("unknown_semantics");
  const leaves = comparison ? comparisonLeaves(comparison) : [];
  const policies = leaves.map((leaf) =>
    "numerical_policy" in leaf.comparison
      ? leaf.comparison.numerical_policy
      : undefined,
  );
  const steps = plan.kind === "cascade" ? plan.steps : [plan];
  const numericSteps = steps.filter(
    (step) =>
      (step.kind === "table_lookup" ? step.value.type : step.type) !== "text" &&
      (step.kind === "table_lookup" ? step.value.type : step.type) !== "enum",
  );
  if (
    numericSteps.some(
      (step) =>
        !(step.kind === "table_lookup"
          ? step.value.number_policy
          : step.number_policy),
    )
  )
    blockers.push("number_policy_required");
  if (comparison && numericSteps.length && policies.some((policy) => !policy))
    blockers.push("numerical_policy_required");
  if (
    passport.rounding !== null &&
    policies.some(
      (policy) =>
        !policy?.rounding ||
        passport.rounding !== JSON.stringify(policy.rounding),
    )
  )
    blockers.push("rounding_policy_mismatch");
  if (policies.some((policy) => policy?.rounding) && passport.rounding === null)
    blockers.push("rounding_basis_missing");
  if (
    leaves.some(
      (leaf) =>
        ["numeric_delta", "no_increase", "no_decrease", "threshold"].includes(
          leaf.comparison.kind,
        ) &&
        !(
          "numerical_policy" in leaf.comparison &&
          leaf.comparison.numerical_policy
        ),
    )
  )
    blockers.push("numerical_policy_required");
  if (passport.source.parameter_code !== rule.parameterCode)
    blockers.push("parameter_mismatch");
  if (!passport.branches.some((b) => b.operator === "extraction"))
    blockers.push("extraction_branch_missing");
  if (comparison && !passport.branches.some((b) => b.operator === "comparison"))
    blockers.push("comparison_branch_missing");
  if (comparison?.kind === "composite") {
    if (
      !passport.branches.some(
        (branch) =>
          branch.id === comparison.root.id && branch.operator === "composite",
      )
    )
      blockers.push("composite_branch_missing");
    for (const leaf of leaves)
      if (
        !passport.branches.some(
          (branch) => branch.id === leaf.id && branch.operator === "comparison",
        )
      )
        blockers.push(`${leaf.id}:comparison_branch_missing`);
  }
  for (const branch of passport.branches) {
    const version =
      branch.operator === "extraction"
        ? regressionEngines.extraction
        : branch.operator === "comparison"
          ? regressionEngines.comparison
          : branch.operator === "composite"
            ? regressionEngines.composite
            : null;
    if (!version || branch.version !== version)
      blockers.push(`${branch.id}:unsupported_operator_version`);
    if (branch.operator === "comparison" && !comparison)
      blockers.push(`${branch.id}:comparison_missing`);
    if (
      branch.operator === "composite" &&
      (comparison?.kind !== "composite" || branch.id !== comparison.root.id)
    )
      blockers.push(`${branch.id}:composite_missing`);
    const leaf =
      comparison?.kind === "composite"
        ? leaves.find((item) => item.id === branch.id)
        : leaves[0];
    if (
      branch.operator === "comparison" &&
      comparison?.kind === "composite" &&
      !leaf
    )
      blockers.push(`${branch.id}:scalar_leaf_missing`);
    const leafPolicy =
      leaf && "numerical_policy" in leaf.comparison
        ? leaf.comparison.numerical_policy
        : undefined;
    const numericBasis =
      branch.operator === "comparison" &&
      (leaf?.comparison.kind === "threshold" ||
        leaf?.comparison.kind === "numeric_delta" ||
        Boolean(leafPolicy?.rounding));
    if (
      (branch.basis_required ||
        numericBasis ||
        branch.operator === "composite") &&
      !branch.basis
    )
      blockers.push(`${branch.id}:unknown_basis`);
    if (REGRESSION_CATEGORIES.every((c) => branch.categories[c] !== null))
      blockers.push(`${branch.id}:all_categories_waived`);
    for (const category of REGRESSION_CATEGORIES) {
      if (
        branch.categories[category] === null &&
        !fixtures.some(
          (f) => f.branch_id === branch.id && f.category === category,
        )
      )
        blockers.push(`${branch.id}:missing_${category}`);
    }
  }
  const cases = fixtures.map((fixture) => {
    const errors: string[] = [];
    const branch = passport.branches.find((b) => b.id === fixture.branch_id);
    if (!branch) errors.push("unknown_branch");
    if (fixture.provenance.kind === "curated" && !fixture.provenance.permission)
      errors.push("curated_permission_missing");
    if (new Set(fixture.inputs.map((i) => i.id)).size !== fixture.inputs.length)
      errors.push("duplicate_input");
    if (
      new Set(fixture.expected.extractions.map((e) => e.input_id)).size !==
        fixture.expected.extractions.length ||
      fixture.expected.extractions.length !== fixture.inputs.length
    )
      errors.push("expected_input_set_mismatch");
    const actual = fixture.inputs.map((input) => {
      if (reviewHash(input.artifact) !== input.artifact_sha256)
        errors.push(`${input.id}:artifact_hash_mismatch`);
      if (
        !record(input.artifact) ||
        typeof input.artifact.source_sha256 !== "string" ||
        typeof input.artifact.pipeline_fingerprint !== "string"
      )
        throw new Error("fixture: отсутствует provenance артефакта");
      const artifact = validateArtifact(
        input.artifact,
        input.artifact.source_sha256,
        input.artifact.pipeline_fingerprint,
      );
      const result = executePlan(artifact, plan, {
        parameter_code: rule.parameterCode,
        rule_version_id: rule.id,
        version: rule.version,
        plan,
        comparison,
      });
      const projection = {
        input_id: input.id,
        status: result.status,
        value_raw: result.value_raw,
        value: result.value,
        unit: result.unit,
        evidence: result.evidence,
        ...(result.numerical ? { numerical: result.numerical } : {}),
      };
      if (
        result.status === "extracted" &&
        passport.unit !== null &&
        (policies.length ? policies : [undefined]).some(
          (policy) =>
            normalizeUnit(policy?.target_unit ?? result.unit) !==
            normalizeUnit(passport.unit),
        )
      )
        errors.push(`${input.id}:passport_unit_mismatch`);
      const expected = fixture.expected.extractions.find(
        (e) => e.input_id === input.id,
      );
      if (!expected || reviewHash(projection) !== reviewHash(expected))
        errors.push(`${input.id}:extraction_assertion_failed`);
      return projection;
    });
    const members: GroupMember[] = actual.map((value, index) => ({
      extraction_id: value.input_id,
      file_id: value.input_id,
      role: fixture.inputs[index]!.role,
      stage: fixture.inputs[index]!.role === "expected" ? "PD" : "RD",
      status: value.status,
      value: value.value,
      value_raw: value.value_raw,
      unit: value.unit,
      ...(value.numerical ? { numerical: value.numerical } : {}),
      evidence: value.evidence,
      document_id: fixture.inputs[index]!.document_id,
      revision_id: fixture.inputs[index]!.revision_id,
      comparison_context: fixture.inputs[index]!.comparison_context,
    }));
    const branchSpec =
      branch?.operator === "composite"
        ? comparison
        : branch?.operator === "comparison"
          ? comparison?.kind === "composite"
            ? (leaves.find((leaf) => leaf.id === branch.id)?.comparison ?? null)
            : comparison
          : null;
    const result = branchSpec
      ? evaluateGroup(members, branchSpec, new Date(0), fixture.context)
      : null;
    const verdict = result?.status ?? null;
    if (branch?.operator === "composite") {
      const projection: NonNullable<
        RegressionFixture["expected"]["composite"]
      > = { result: result?.composite?.result ?? "unknown", branches: [] };
      const visit = (node: CompositeBranchTrace) => {
        projection.branches.push({
          id: node.id,
          result: node.result,
          evaluated: node.evaluated,
        });
        node.children.forEach(visit);
      };
      if (result?.composite) visit(result.composite.root);
      if (
        !fixture.expected.composite ||
        reviewHash(projection) !== reviewHash(fixture.expected.composite)
      )
        errors.push("composite_trace_assertion_failed");
    } else if (fixture.expected.composite)
      errors.push("unexpected_composite_assertion");
    if (verdict !== fixture.expected.verdict)
      errors.push("verdict_assertion_failed");
    const hasUnknownBranch = (node: CompositeBranchTrace): boolean =>
      node.result === "unknown" || node.children.some(hasUnknownBranch);
    if (
      fixture.category === "uncertain" &&
      actual.every((value) => value.status === "extracted") &&
      (verdict === null || verdict === "match" || verdict === "discrepancy") &&
      !(result?.composite && hasUnknownBranch(result.composite.root))
    )
      errors.push("uncertain_case_has_no_uncertainty");
    return {
      id: fixture.id,
      branch_id: fixture.branch_id,
      category: fixture.category,
      fixture_hash: reviewHash(fixture),
      provenance: fixture.provenance,
      input_hashes: fixture.inputs.map((i) => ({
        id: i.id,
        artifact_sha256: i.artifact_sha256,
      })),
      expected: fixture.expected,
      actual: {
        extractions: actual,
        verdict,
        ...(result?.composite ? { composite: result.composite } : {}),
      },
      passed: errors.length === 0,
      errors,
    };
  });
  return {
    schema_version: 1,
    rule_hash: reviewedRuleHash(rule, reviewHash(passport)),
    passport_hash: reviewHash(passport),
    fixtures_hash: reviewHash(fixtures),
    engine_fingerprint: reviewHash(regressionEngines),
    engines: regressionEngines,
    passed: blockers.length === 0 && cases.every((c) => c.passed),
    blockers,
    cases,
    waivers: passport.branches.flatMap((b) =>
      REGRESSION_CATEGORIES.filter((c) => b.categories[c] !== null).map(
        (c) => ({ branch_id: b.id, category: c, reason: b.categories[c] }),
      ),
    ),
    quality: {
      synthetic_cases: fixtures.filter((f) => f.provenance.kind === "synthetic")
        .length,
      curated_cases: fixtures.filter((f) => f.provenance.kind === "curated")
        .length,
      corpus_accuracy: null,
      statement:
        "Регрессии конкретных примеров не измеряют точность на независимом корпусе; synthetic не является реальным документом.",
    },
  };
}
