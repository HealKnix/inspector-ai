import { z } from "zod";

const resultSchema = z.enum(["true", "false", "unknown"]);
const applicabilitySchema = z.enum(["applicable", "not_applicable", "unknown"]);
const referenceSchema = z.object({
  document_id: z.string(),
  revision_id: z.string(),
});
const leafSpecSchema = z
  .object({
    kind: z.enum([
      "equals",
      "numeric_delta",
      "no_decrease",
      "no_increase",
      "threshold",
      "ordered_category",
    ]),
  })
  .catchall(z.unknown());
type CompositeNode =
  | { id: string; kind: "and" | "or"; children: CompositeNode[] }
  | { id: string; kind: "scalar"; comparison: z.infer<typeof leafSpecSchema> };
const compositeNodeSchema: z.ZodType<CompositeNode> = z.lazy(() =>
  z.union([
    z.object({
      id: z.string(),
      kind: z.enum(["and", "or"]),
      children: z.array(compositeNodeSchema).min(2).max(8),
    }),
    z.object({
      id: z.string(),
      kind: z.literal("scalar"),
      comparison: leafSpecSchema,
    }),
  ]),
);
// Bound recursive API data before Zod traverses it, using the producer's limits.
const boundedTree = z.unknown().superRefine((payload, ctx) => {
  if (!payload || typeof payload !== "object" || !("root" in payload)) return;
  const pending = [{ node: payload.root, depth: 1 }];
  const ids = new Set<string>();
  let count = 0;
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (++count > 64 || depth > 6) {
      ctx.addIssue({
        code: "custom",
        message: "Composite tree limit exceeded",
      });
      return;
    }
    if (!node || typeof node !== "object") continue;
    if ("id" in node && typeof node.id === "string") {
      if (ids.has(node.id)) {
        ctx.addIssue({ code: "custom", message: "Duplicate composite branch" });
        return;
      }
      ids.add(node.id);
    }
    if ("children" in node && Array.isArray(node.children)) {
      if (node.children.length > 8) {
        ctx.addIssue({
          code: "custom",
          message: "Composite children limit exceeded",
        });
        return;
      }
      for (const child of node.children)
        pending.push({ node: child as unknown, depth: depth + 1 });
    }
  }
});
export const compositeSpecSchema = boundedTree.pipe(
  z.object({
    kind: z.literal("composite"),
    schema_version: z.literal(1),
    root: compositeNodeSchema,
  }),
);

const memberSchema = z.object({
  extraction_id: z.string(),
  file_id: z.string(),
  value: z.union([z.string(), z.number()]),
  value_raw: z.string().nullable(),
  unit: z.string().nullable(),
});
const scalarVerdictSchema = z.object({
  engine: z.string(),
  status: z.enum([
    "match",
    "discrepancy",
    "expected_missing",
    "actual_missing",
    "expected_ambiguous",
    "actual_ambiguous",
    "not_comparable",
    "no_comparison",
  ]),
  spec: leafSpecSchema.nullable(),
  expected: z.array(memberSchema).nullable(),
  actual: z.array(memberSchema).nullable(),
  pairs: z.array(
    z.object({
      expected_extraction_id: z.string().nullable(),
      actual_extraction_id: z.string().nullable(),
      result: z.enum(["match", "mismatch", "not_comparable"]),
      delta: z.number().nullable(),
      delta_pct: z.number().nullable(),
      detail: z.string().nullable(),
      trace: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
  warnings: z.array(z.string()),
  evaluated_at: z.string(),
  rule_basis: z.record(z.string(), z.unknown()).optional(),
  composite: z.never().optional(),
});
export const compositeSourceSchema = z.object({
  extraction_id: z.string(),
  file_id: z.string(),
  artifact_id: z.string().nullable(),
  document_id: z.string().nullable(),
  revision_id: z.string().nullable(),
  evidence: z.array(z.unknown()),
});
export type CompositeSource = z.infer<typeof compositeSourceSchema>;
export interface CompositeBranchTrace {
  id: string;
  kind: "and" | "or" | "scalar";
  result: z.infer<typeof resultSchema>;
  applicability: z.infer<typeof applicabilitySchema>;
  evaluated: boolean;
  reasons: string[];
  determining_branch_ids: string[];
  children: CompositeBranchTrace[];
  scalar: z.infer<typeof scalarVerdictSchema> | null;
  sources: CompositeSource[];
}
const branchSchema: z.ZodType<CompositeBranchTrace> = z.lazy(() =>
  z.object({
    id: z.string(),
    kind: z.enum(["and", "or", "scalar"]),
    result: resultSchema,
    applicability: applicabilitySchema,
    evaluated: z.boolean(),
    reasons: z.array(z.string()),
    determining_branch_ids: z.array(z.string()),
    children: z.array(branchSchema).max(8),
    scalar: scalarVerdictSchema.nullable(),
    sources: z.array(compositeSourceSchema),
  }),
);
export const compositeTraceSchema = boundedTree.pipe(
  z.object({
    schema_version: z.literal(1),
    kind: z.literal("composite"),
    engine: z.literal("composite-scalar-v1"),
    result: resultSchema,
    applicability: applicabilitySchema,
    resolved_input_hash: z.string(),
    context: z
      .object({
        context_id: z.string(),
        scope_key: z.string(),
        period_key: z.string().nullable(),
        reference: referenceSchema.nullable(),
        actual: referenceSchema.nullable(),
        applicability: applicabilitySchema,
        applicability_basis: z.string().nullable(),
      })
      .nullable(),
    root: branchSchema,
  }),
);
export type CompositeComparisonTrace = z.infer<typeof compositeTraceSchema>;

/** Navigation targets are resolved by the owning page against loaded, authorized
 * source artifacts. Raw IDs from the trace never become navigation URLs. */
export interface ComparisonSourceTarget {
  extractionId: string;
  fileId: string;
  artifactId: string;
  page: number;
  blockId: string | null;
  label: string;
}
