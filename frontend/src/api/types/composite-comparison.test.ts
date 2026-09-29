import {
  compositeSpecSchema,
  compositeTraceSchema,
} from "./composite-comparison";
import { compositeTraceFixture } from "./composite-comparison-test-fixtures";
import { evidenceGroupSchema } from "./extraction";
import { groupVerdictSchema } from "./verification";

const spec = {
  kind: "composite",
  schema_version: 1,
  root: {
    id: "root",
    kind: "or",
    children: [
      { id: "known", kind: "scalar", comparison: { kind: "equals" } },
      {
        id: "unresolved",
        kind: "scalar",
        comparison: { kind: "threshold", min: "0.000000000000000001" },
      },
    ],
  },
};
const legacy = {
  engine: "comparison-engine-v3",
  status: "match",
  spec: { kind: "equals" },
  expected: null,
  actual: null,
  pairs: [],
  warnings: [],
  evaluated_at: "2026-09-28T00:00:00Z",
};
function extractionGroup(verdict: unknown) {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    parameter_code: "P001",
    scope_key: "object",
    ruleset_hash: "synthetic",
    members: [],
    verdict,
    updated_at: "2026-09-28T00:00:00Z",
  };
}
it("preserves the complete composite trace on both API paths", () => {
  const composite = compositeTraceFixture();
  const verdict = { ...legacy, spec, composite };
  expect(groupVerdictSchema.parse(verdict).composite).toEqual(composite);
  const parsed = evidenceGroupSchema.parse(extractionGroup(verdict)).verdict!;
  expect(parsed.composite).toEqual(composite);
  expect(parsed.spec).toEqual(spec);
});
it("accepts legacy scalar results without fabricating a tree", () => {
  expect(groupVerdictSchema.parse(legacy)).not.toHaveProperty("composite");
  expect(
    evidenceGroupSchema.parse(extractionGroup(legacy)).verdict,
  ).not.toHaveProperty("composite");
});
it("retains unknown applicability and unexecuted branches as unknown", () => {
  const trace = compositeTraceFixture("and");
  trace.result = trace.root.result = "unknown";
  trace.applicability = trace.root.applicability = "unknown";
  trace.root.evaluated = false;
  trace.root.children = trace.root.children.map((branch) => ({
    ...branch,
    result: "unknown",
    applicability: "unknown",
    evaluated: false,
    scalar: null,
    reasons: ["composite_applicability_unknown"],
  }));
  const parsed = compositeTraceSchema.parse(trace);
  expect(
    parsed.root.children.every(
      (branch) => !branch.evaluated && branch.result === "unknown",
    ),
  ).toBe(true);
});
it("rejects unsupported nodes and malformed trace results without falling back to scalar", () => {
  expect(
    compositeSpecSchema.safeParse({
      ...spec,
      root: { id: "root", kind: "presence" },
    }).success,
  ).toBe(false);
  const trace = compositeTraceFixture();
  expect(
    compositeTraceSchema.safeParse({ ...trace, result: false }).success,
  ).toBe(false);
  const withoutSources = structuredClone(trace) as unknown as {
    root: { children: Record<string, unknown>[] };
  };
  delete withoutSources.root.children[0]!.sources;
  expect(
    groupVerdictSchema.safeParse({ ...legacy, spec, composite: withoutSources })
      .success,
  ).toBe(false);
});
it("bounds recursive input and rejects duplicate branch IDs before rendering", () => {
  const trace = compositeTraceFixture();
  trace.root.children[1]!.id = "known";
  expect(compositeTraceSchema.safeParse(trace).success).toBe(false);
  const cyclic = compositeTraceFixture();
  cyclic.root.children = [cyclic.root];
  expect(compositeTraceSchema.safeParse(cyclic).success).toBe(false);
});
