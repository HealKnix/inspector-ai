import { describe, expect, it } from "vitest";
import {
  COMPARISON_ENGINE_VERSION,
  validateComparisonSpec,
  type CompositeComparisonSpec,
  type CompositeNode,
  type LeafComparisonSpec,
} from "./comparison-contract.js";
import { evaluateGroup, type GroupMember } from "./comparison-engine.js";
import {
  compositeSemanticBasis,
  compositeTruth,
  type CompositeEvaluationContext,
  type CompositeTruth,
} from "./composite-comparison.js";
import { unitDefinition, type NumericalPolicy } from "./numerical-policy.js";

const NOW = new Date("2026-09-28T00:00:00Z");
const policy: NumericalPolicy = {
  version: "decimal-units-v1",
  target_unit: "m",
  zero_expected: "not_comparable",
  allow_percent_fraction: false,
  rounding: null,
};
const binding = {
  context_id: "synthetic-context",
  scope_key: "synthetic-element",
  period_key: "synthetic-period",
};
const context: CompositeEvaluationContext = {
  ...binding,
  reference: { document_id: "pd", revision_id: "pd-v1" },
  actual: { document_id: "rd", revision_id: "rd-v1" },
  applicability: "applicable",
  applicability_basis: "Synthetic test only; no normative assertion",
};
function members(unit = "m"): GroupMember[] {
  return (["expected", "actual"] as const).map((role) => {
    const ref = role === "expected" ? context.reference! : context.actual!;
    const point = role === "expected" && unit === "mm" ? "1000" : "1";
    const sourceUnit = role === "expected" ? unit : "m";
    const definition = unitDefinition(sourceUnit)!;
    const evidence = [
      {
        page_number: 1,
        sheet_label: null,
        block_id: role,
        table_id: null,
        table_row: null,
        table_column: null,
        quote: `${point} ${sourceUnit}`,
        bbox: [0.1, 0.1, 0.9, 0.2] as [number, number, number, number],
        structural_path: null,
      },
    ];
    return {
      extraction_id: role,
      file_id: ref.document_id,
      artifact_id: `${role}-artifact`,
      stage: role === "expected" ? "PD" : "RD",
      role,
      status: "extracted",
      value: point,
      value_raw: `${point} ${sourceUnit}`,
      unit: sourceUnit,
      ...ref,
      comparison_context: binding,
      evidence,
      numerical: {
        schema_version: 1,
        decimal: point,
        unit: {
          raw: sourceUnit,
          canonical: definition.canonical,
          dimension: definition.dimension,
          source: "value",
          evidence,
        },
        uncertainty: null,
      },
    };
  });
}
function leaf(id: string, comparison: LeafComparisonSpec): CompositeNode {
  return { id, kind: "scalar", comparison };
}
function tree(
  kind: "and" | "or",
  children: CompositeNode[],
): CompositeComparisonSpec {
  return {
    kind: "composite",
    schema_version: 1,
    root: { id: "root", kind, children },
  };
}
const equal: LeafComparisonSpec = { kind: "equals", numerical_policy: policy };
const falseLeaf: LeafComparisonSpec = {
  kind: "threshold",
  min: "2",
  min_inclusive: true,
  numerical_policy: policy,
};
const unknownLeaf: LeafComparisonSpec = {
  kind: "equals",
  numerical_policy: { ...policy, target_unit: "kg" },
};

describe("bounded composite scalar contract", () => {
  it("keeps scalar validation backward compatible and strictly versions trees", () => {
    expect(validateComparisonSpec({ kind: "equals" })).toEqual({
      kind: "equals",
    });
    const valid = tree("and", [leaf("a", equal), leaf("b", equal)]);
    expect(validateComparisonSpec(valid)).toEqual(valid);
    for (const value of [
      { ...valid, schema_version: 2 },
      { ...valid, code: "process.exit()" },
      { ...valid, root: { ...valid.root, kind: "presence" } },
      { ...valid, root: leaf("a", equal) },
    ])
      expect(() => validateComparisonSpec(value)).toThrow();
    expect(() =>
      validateComparisonSpec(tree("and", [leaf("a", equal), leaf("a", equal)])),
    ).toThrow(/id/);
    expect(() =>
      validateComparisonSpec(
        tree("and", [
          leaf("a", valid as unknown as LeafComparisonSpec),
          leaf("b", equal),
        ]),
      ),
    ).toThrow(/scalar/);
  });
  it("rejects cycles, unsupported leaves, unknown fields, breadth and depth overflow", () => {
    const cyclic = tree("and", [leaf("a", equal)]);
    if (cyclic.root.kind !== "scalar") cyclic.root.children.push(cyclic.root);
    expect(() => evaluateGroup(members(), cyclic, NOW, context)).toThrow(
      /цикл/,
    );
    expect(() => validateComparisonSpec(tree("or", []))).toThrow();
    expect(() =>
      validateComparisonSpec(
        tree(
          "or",
          Array.from({ length: 9 }, (_, i) => leaf(`n${i}`, equal)),
        ),
      ),
    ).toThrow();
    expect(() =>
      validateComparisonSpec(
        tree("and", [
          { id: "presence", kind: "presence" } as unknown as CompositeNode,
          leaf("b", equal),
        ]),
      ),
    ).toThrow();
    expect(() =>
      validateComparisonSpec(
        tree("and", [
          {
            ...leaf("a", equal),
            expression: "true",
          } as unknown as CompositeNode,
          leaf("b", equal),
        ]),
      ),
    ).toThrow();
    let node = leaf("bottom", equal);
    for (let i = 0; i < 6; i++)
      node = {
        id: `level${i}`,
        kind: "and",
        children: [leaf(`side${i}`, equal), node],
      };
    expect(() =>
      validateComparisonSpec({
        kind: "composite",
        schema_version: 1,
        root: node,
      }),
    ).toThrow(/лимит/);
    const wide = tree(
      "and",
      Array.from({ length: 8 }, (_, i) => ({
        id: `group${i}`,
        kind: "and",
        children: Array.from({ length: 8 }, (_, j) =>
          leaf(`leaf${i}_${j}`, equal),
        ),
      })),
    );
    expect(() => validateComparisonSpec(wide)).toThrow(/лимит/);
  });
});

describe("three-valued AND/OR (synthetic truth tables)", () => {
  const values: CompositeTruth[] = ["true", "false", "unknown"];
  const tables = {
    and: [
      ["true", "false", "unknown"],
      ["false", "false", "false"],
      ["unknown", "false", "unknown"],
    ],
    or: [
      ["true", "true", "true"],
      ["true", "false", "unknown"],
      ["true", "unknown", "unknown"],
    ],
  } as const;
  for (const kind of ["and", "or"] as const)
    for (const [i, left] of values.entries())
      for (const [j, right] of values.entries())
        it(`${kind}: ${left}, ${right}`, () => {
          expect(compositeTruth(kind, [left, right])).toBe(tables[kind][i]![j]);
          const specs = { true: equal, false: falseLeaf, unknown: unknownLeaf };
          const result = evaluateGroup(
            members(),
            tree(kind, [leaf("a", specs[left]), leaf("b", specs[right])]),
            NOW,
            context,
          );
          expect(result.composite?.result).toBe(tables[kind][i]![j]);
          expect(
            result.composite?.root.children.map((child) => child.result),
          ).toEqual([left, right]);
          expect(
            result.composite?.root.children.every((child) => child.evaluated),
          ).toBe(true);
        });
  it("does not hide unknown evidence behind a determining OR branch", () => {
    const result = evaluateGroup(
      members(),
      tree("or", [leaf("yes", equal), leaf("unknown", unknownLeaf)]),
      NOW,
      context,
    );
    expect(result.status).toBe("match");
    expect(result.composite?.root.determining_branch_ids).toEqual(["yes"]);
    expect(result.composite?.root.children[1]).toMatchObject({
      result: "unknown",
      evaluated: true,
      reasons: ["unit_dimension_mismatch", "scalar_not_comparable"],
    });
    expect(result.composite?.root.children[1]?.sources[0]?.evidence).toEqual(
      members()[0]!.evidence,
    );
  });
  it("delegates exact units, inclusive bounds and uncertainty identically inside and outside a tree", () => {
    for (const input of [members("mm"), members("kg"), members()]) {
      const uncertain = structuredClone(input);
      uncertain[1]!.numerical!.uncertainty = {
        lower: "0.9",
        upper: "1.1",
        basis: { reference: "synthetic", version: "1", locator: "case" },
      };
      for (const values of [input, uncertain])
        for (const spec of [
          equal,
          {
            kind: "threshold",
            min: "1",
            min_inclusive: false,
            numerical_policy: policy,
          } satisfies LeafComparisonSpec,
          {
            kind: "numeric_delta",
            tolerance_abs: "0.1",
            inclusive: true,
            numerical_policy: policy,
          } satisfies LeafComparisonSpec,
        ]) {
          const standalone = evaluateGroup(structuredClone(values), spec, NOW);
          const composed = evaluateGroup(
            values,
            tree("and", [leaf("a", spec), leaf("b", equal)]),
            NOW,
            context,
          );
          expect(composed.composite?.root.children[0]?.scalar).toEqual(
            standalone,
          );
        }
    }
  });
  it("retains unknown for absent evidence without asserting absence and reproduces a full trace", () => {
    const input = members();
    input[1]!.status = "no_evidence";
    input[1]!.value = null;
    const spec = tree("and", [leaf("a", equal), leaf("b", equal)]);
    const result = evaluateGroup(input, spec, NOW, context);
    expect(result.status).toBe("not_comparable");
    expect(result.engine).toBe(COMPARISON_ENGINE_VERSION);
    expect(result.composite?.root.children[0]?.scalar?.status).toBe(
      "actual_missing",
    );
    expect(evaluateGroup(input, spec, NOW, context)).toEqual(result);
  });
  it("blocks mismatched element, period, context or revision before an OR can falsely succeed", () => {
    const spec = tree("or", [leaf("a", equal), leaf("b", equal)]);
    for (const key of ["context_id", "scope_key", "period_key"] as const) {
      const input = members();
      input[1]!.comparison_context = { ...binding, [key]: "other" };
      const result = evaluateGroup(input, spec, NOW, context);
      expect(result.status).toBe("not_comparable");
      expect(result.warnings).toContain("composite_member_context_mismatch");
      expect(
        result.composite?.root.children.every(
          (child) => !child.evaluated && child.scalar === null,
        ),
      ).toBe(true);
    }
    const input = members();
    input[1]!.revision_id = "stale";
    expect(evaluateGroup(input, spec, NOW, context).warnings).toContain(
      "composite_revision_mismatch",
    );
    delete input[0]!.comparison_context;
    expect(evaluateGroup(input, spec, NOW, context).warnings).toContain(
      "composite_member_context_missing",
    );
    expect(evaluateGroup(members(), spec, NOW).status).toBe("not_comparable");
  });
  it("keeps applicability separate, with no vacuous match for inapplicable or unknown inputs", () => {
    for (const applicability of ["not_applicable", "unknown"] as const) {
      const result = evaluateGroup(
        members(),
        tree("and", [leaf("a", equal), leaf("b", equal)]),
        NOW,
        { ...context, applicability },
      );
      expect(result.composite).toMatchObject({
        result: "unknown",
        applicability,
      });
      expect(
        result.composite?.root.children.every((child) => !child.evaluated),
      ).toBe(true);
    }
    expect(
      evaluateGroup(
        members(),
        tree("and", [leaf("a", equal), leaf("b", equal)]),
        NOW,
        { ...context, applicability_basis: null },
      ).warnings,
    ).toContain("composite_applicability_basis_missing");
  });
  it("fingerprints semantic branch/applicability decisions without per-run IDs or timestamps", () => {
    const spec = tree("or", [leaf("a", equal), leaf("b", unknownLeaf)]);
    const first = evaluateGroup(members(), spec, NOW, context).composite!;
    const changedIds = members().map((member) => ({
      ...member,
      extraction_id: `${member.extraction_id}-new`,
      file_id: `${member.file_id}-new`,
      artifact_id: `${member.artifact_id}-new`,
    }));
    const rerun = evaluateGroup(
      changedIds,
      spec,
      new Date("2026-10-01"),
      context,
    ).composite!;
    expect(rerun.resolved_input_hash).not.toBe(first.resolved_input_hash);
    expect(compositeSemanticBasis(rerun)).toEqual(
      compositeSemanticBasis(first),
    );
    const changedBasis = structuredClone(first);
    changedBasis.context!.applicability_basis =
      "Different confirmed subject assessment";
    expect(compositeSemanticBasis(changedBasis)).not.toEqual(
      compositeSemanticBasis(first),
    );
    const changedBranch = structuredClone(first);
    changedBranch.root.children[1]!.reasons = ["different_unknown_reason"];
    expect(compositeSemanticBasis(changedBranch)).not.toEqual(
      compositeSemanticBasis(first),
    );
  });
});
