import { describe, expect, it } from "vitest";
import { passportInputSchema, regressionInputSchema } from "./matrix-review";

describe("bounded composite admin payloads", () => {
  it("preserves the server's 65 passport branches and 260 fixture bounds", () => {
    const branches = Array.from({ length: 65 }, (_, i) => ({
      id: `b${i}`,
      operator: "comparison",
      version: "comparison-engine-v4",
      basis_required: false,
      basis: null,
      categories: {
        positive: null,
        negative: null,
        boundary: null,
        uncertain: null,
      },
    }));
    const passport = {
      schema_version: 1,
      matrix_row_id: "00000000-0000-4000-8000-000000000001",
      quantity: null,
      applicability: null,
      scope: null,
      sources: ["RD"],
      unit: null,
      rounding: null,
      branches,
    };
    expect(passportInputSchema.parse(passport).branches).toHaveLength(65);
    expect(
      passportInputSchema.safeParse({
        ...passport,
        branches: [...branches, branches[0]],
      }).success,
    ).toBe(false);
    const fixtures = Array.from({ length: 260 }, (_, i) => ({
      id: `case-${i}`,
      expected: {
        composite_branches: [
          { id: "leaf", result: "unknown", evaluated: false },
        ],
      },
    }));
    expect(
      regressionInputSchema.parse({ schema_version: 1, fixtures }).fixtures,
    ).toEqual(fixtures);
    expect(
      regressionInputSchema.safeParse({
        schema_version: 1,
        fixtures: [...fixtures, fixtures[0]],
      }).success,
    ).toBe(false);
  });
});
