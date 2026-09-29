import type {
  CompositeComparisonSpec,
  LeafComparisonSpec,
} from "../../src/modules/extraction/comparison-contract.js";
import type { CompositeEvaluationContext } from "../../src/modules/extraction/composite-comparison.js";
import {
  regressionEngines,
  type RegressionFixture,
} from "../../src/modules/extraction/matrix-review-contract.js";
import {
  syntheticPassportInput,
  syntheticRegressionFixtures,
  syntheticReviewRule,
} from "./matrix-review-fixture.js";

/** Manual synthetic oracle: both leaves compare the same one quantity. This is
 * an operator/HTTP fixture, not a real document or a Matrix rule approval. */
export function syntheticCompositeReview(rowId: string) {
  const comparison: CompositeComparisonSpec = {
    kind: "composite",
    schema_version: 1,
    root: {
      id: "root",
      kind: "and",
      children: ["first", "second"].map((id) => ({
        id,
        kind: "scalar",
        comparison: structuredClone(
          syntheticReviewRule.comparison,
        ) as LeafComparisonSpec,
      })),
    },
  };
  const passport = syntheticPassportInput(rowId);
  const scalar = passport.branches[1]!;
  passport.branches = [
    passport.branches[0]!,
    { ...scalar, id: "first" },
    { ...scalar, id: "second" },
    {
      ...scalar,
      id: "root",
      operator: "composite",
      version: regressionEngines.composite,
      basis_required: true,
      basis: {
        reference: "Synthetic AND, no domain norm",
        version: "1",
        locator: "composite-review-fixture.ts",
        valid_from: null,
        valid_to: null,
      },
    },
  ];
  const context: CompositeEvaluationContext = {
    context_id: "synthetic-http-context",
    scope_key: "synthetic-element",
    period_key: null,
    reference: { document_id: "synthetic-pd", revision_id: "pd-v1" },
    actual: { document_id: "synthetic-rd", revision_id: "rd-v1" },
    applicability: "applicable",
    applicability_basis:
      "Explicit synthetic applicability; not a production assessment",
  };
  const source = syntheticRegressionFixtures();
  const fixtures: RegressionFixture[] = source.filter(
    (f) => f.branch_id === "extraction",
  );
  for (const fixture of source.filter((f) => f.branch_id === "comparison")) {
    for (const branchId of ["first", "second", "root"]) {
      const item = structuredClone(fixture);
      item.id = `${branchId}-${item.category}`;
      item.branch_id = branchId;
      if (branchId === "root") {
        item.context = structuredClone(context);
        item.inputs = item.inputs.map((input) => ({
          ...input,
          ...(input.role === "expected" ? context.reference! : context.actual!),
          comparison_context: {
            context_id: context.context_id,
            scope_key: context.scope_key,
            period_key: context.period_key,
          },
        }));
        // Source helper has expected/actual 10/11, 10/10, 10/10, 10/missing.
        // Expected outcomes are authored from those values, never from CMP.
        const result =
          item.category === "positive"
            ? "false"
            : item.category === "uncertain"
              ? "unknown"
              : "true";
        item.expected.verdict =
          result === "false"
            ? "discrepancy"
            : result === "true"
              ? "match"
              : "not_comparable";
        item.expected.composite = {
          result,
          branches: ["root", "first", "second"].map((id) => ({
            id,
            result,
            evaluated: true,
          })),
        };
      }
      fixtures.push(item);
    }
  }
  return { plan: syntheticReviewRule.plan, comparison, passport, fixtures };
}
