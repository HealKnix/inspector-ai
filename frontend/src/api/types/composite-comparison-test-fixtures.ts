import type {
  CompositeBranchTrace,
  CompositeComparisonTrace,
} from "./composite-comparison";

export const compositeSourceFixture = {
  extraction_id: "11111111-1111-4111-8111-111111111111",
  file_id: "22222222-2222-4222-8222-222222222222",
  artifact_id: "33333333-3333-4333-8333-333333333333",
  document_id: "synthetic-document",
  revision_id: "synthetic-revision",
  evidence: [
    { page_number: 3, block_id: "p3-b2", quote: "Синтетический пример" },
  ],
};
export function compositeBranchFixture(
  id: string,
  result: CompositeBranchTrace["result"],
): CompositeBranchTrace {
  return {
    id,
    kind: "scalar",
    result,
    applicability: "applicable",
    evaluated: true,
    reasons: result === "unknown" ? ["scalar_actual_missing"] : [],
    determining_branch_ids: result === "unknown" ? [] : [id],
    children: [],
    sources: [compositeSourceFixture],
    scalar: {
      engine: "comparison-engine-v4",
      status:
        result === "true"
          ? "match"
          : result === "false"
            ? "discrepancy"
            : "actual_missing",
      spec: { kind: "equals" },
      expected: null,
      actual: null,
      pairs: [],
      warnings: [],
      evaluated_at: "2026-09-28T00:00:00Z",
    },
  };
}
export function compositeTraceFixture(
  kind: "and" | "or" = "or",
): CompositeComparisonTrace {
  const result = kind === "or" ? "true" : "unknown";
  return {
    schema_version: 1,
    kind: "composite",
    engine: "composite-scalar-v1",
    result,
    applicability: "applicable",
    resolved_input_hash: "a".repeat(64),
    context: {
      context_id: "synthetic-context",
      scope_key: "Синтетическая область",
      period_key: null,
      reference: null,
      actual: {
        document_id: "synthetic-document",
        revision_id: "synthetic-revision",
      },
      applicability: "applicable",
      applicability_basis: "Синтетическое основание",
    },
    root: {
      id: "root",
      kind,
      result,
      applicability: "applicable",
      evaluated: true,
      reasons: result === "unknown" ? ["composite_branch_unknown"] : [],
      determining_branch_ids: [kind === "or" ? "known" : "unresolved"],
      children: [
        compositeBranchFixture("known", "true"),
        compositeBranchFixture("unresolved", "unknown"),
      ],
      scalar: null,
      sources: [],
    },
  };
}
