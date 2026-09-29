import { Ajv } from "ajv";
import { createHash } from "node:crypto";
import { canonicalJson } from "../documents/canonical-json.js";
import {
  COMPARISON_ENGINE_VERSION,
  COMPOSITE_ENGINE_VERSION,
} from "./comparison-contract.js";
import type { VerdictStatus } from "./comparison-engine.js";
import {
  validateCompositeContext,
  validCompositeBinding,
  type CompositeContextBinding,
  type CompositeEvaluationContext,
  type CompositeTruth,
} from "./composite-comparison.js";
import {
  EXTRACTION_ENGINE_VERSION,
  type EvidenceLocator,
  type ExtractionStatus,
} from "./extraction-contract.js";

export const MATRIX_REVIEW_VERSION = "matrix-review-v1";
export const REGRESSION_CATEGORIES = [
  "positive",
  "negative",
  "boundary",
  "uncertain",
] as const;
export type RegressionCategory = (typeof REGRESSION_CATEGORIES)[number];
export interface RuleBasis {
  reference: string;
  version: string;
  locator: string;
  valid_from: string | null;
  valid_to: string | null;
}
export interface PassportInput {
  schema_version: 1;
  matrix_row_id: string;
  quantity: string | null;
  applicability: string | null;
  scope: string | null;
  sources: string[];
  unit: string | null;
  rounding: string | null;
  branches: {
    id: string;
    operator: string;
    version: string;
    basis_required: boolean;
    basis: RuleBasis | null;
    // null requires a case; a non-empty reason explicitly waives that category.
    categories: Record<RegressionCategory, string | null>;
  }[];
}
export interface RulePassportContent extends PassportInput {
  source: {
    import_id: string;
    catalog_sha256: string;
    origin_sha256: string;
    row_sha256: string;
    parameter_code: string;
    trigger: string;
  };
}
export interface RegressionFixture {
  id: string;
  branch_id: string;
  category: RegressionCategory;
  provenance: {
    kind: "synthetic" | "curated";
    reference: string;
    permission: string | null;
  };
  inputs: {
    id: string;
    role: "expected" | "actual";
    artifact_sha256: string;
    artifact: unknown;
    document_id?: string;
    revision_id?: string;
    comparison_context?: CompositeContextBinding;
  }[];
  context?: CompositeEvaluationContext;
  expected: {
    extractions: {
      input_id: string;
      status: ExtractionStatus;
      value_raw: string | null;
      value: string | number | null;
      unit: string | null;
      evidence: EvidenceLocator[];
      numerical?: unknown;
    }[];
    verdict: VerdictStatus | null;
    composite?: {
      result: CompositeTruth;
      branches: { id: string; result: CompositeTruth; evaluated: boolean }[];
    };
  };
}

const text = { type: "string", minLength: 1, maxLength: 2000, pattern: "\\S" };
const nullableText = { anyOf: [text, { type: "null" }] };
const hash = { type: "string", pattern: "^[a-f0-9]{64}$" };
const object = (
  properties: Record<string, unknown>,
  optional: string[] = [],
) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties).filter((key) => !optional.includes(key)),
});
export const passportInputSchema = object({
  schema_version: { const: 1 },
  matrix_row_id: { type: "string", pattern: "^[a-f0-9-]{36}$" },
  quantity: nullableText,
  applicability: nullableText,
  scope: nullableText,
  sources: {
    type: "array",
    minItems: 1,
    maxItems: 3,
    uniqueItems: true,
    items: { enum: ["PD", "RD", "ID"] },
  },
  unit: nullableText,
  rounding: nullableText,
  branches: {
    type: "array",
    minItems: 1,
    maxItems: 65,
    items: object({
      id: text,
      operator: text,
      version: text,
      basis_required: { type: "boolean" },
      basis: {
        anyOf: [
          object({
            reference: text,
            version: text,
            locator: text,
            valid_from: nullableText,
            valid_to: nullableText,
          }),
          { type: "null" },
        ],
      },
      categories: object(
        Object.fromEntries(
          REGRESSION_CATEGORIES.map((category) => [category, nullableText]),
        ),
      ),
    }),
  },
});
const locatorSchema = object({
  page_number: { type: "integer", minimum: 1 },
  sheet_label: nullableText,
  block_id: nullableText,
  table_id: nullableText,
  table_row: { type: ["integer", "null"], minimum: 0 },
  table_column: { type: ["integer", "null"], minimum: 0 },
  quote: text,
  bbox: {
    anyOf: [
      { type: "null" },
      {
        type: "array",
        minItems: 4,
        maxItems: 4,
        items: { type: "number", minimum: 0, maximum: 1 },
      },
    ],
  },
  structural_path: nullableText,
});
export const regressionInputSchema = object({
  schema_version: { const: 1 },
  fixtures: {
    type: "array",
    minItems: 1,
    maxItems: 260,
    items: object(
      {
        id: text,
        branch_id: text,
        category: { enum: REGRESSION_CATEGORIES },
        provenance: object({
          kind: { enum: ["synthetic", "curated"] },
          reference: text,
          permission: nullableText,
        }),
        inputs: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: object(
            {
              id: text,
              role: { enum: ["expected", "actual"] },
              artifact_sha256: hash,
              artifact: { type: "object" },
              document_id: text,
              revision_id: text,
              comparison_context: { type: "object" },
            },
            ["document_id", "revision_id", "comparison_context"],
          ),
        },
        context: { type: "object" },
        expected: object(
          {
            extractions: {
              type: "array",
              minItems: 1,
              maxItems: 8,
              items: object(
                {
                  input_id: text,
                  status: {
                    enum: [
                      "extracted",
                      "ambiguous",
                      "no_evidence",
                      "unreadable",
                      "unsupported",
                    ],
                  },
                  value_raw: nullableText,
                  value: { type: ["string", "number", "null"] },
                  unit: nullableText,
                  evidence: {
                    type: "array",
                    maxItems: 64,
                    items: locatorSchema,
                  },
                  numerical: { type: "object" },
                },
                ["numerical"],
              ),
            },
            verdict: {
              enum: [
                null,
                "match",
                "discrepancy",
                "expected_missing",
                "actual_missing",
                "expected_ambiguous",
                "actual_ambiguous",
                "not_comparable",
                "no_comparison",
              ],
            },
            composite: object({
              result: { enum: ["true", "false", "unknown"] },
              branches: {
                type: "array",
                minItems: 1,
                maxItems: 64,
                items: object({
                  id: text,
                  result: { enum: ["true", "false", "unknown"] },
                  evaluated: { type: "boolean" },
                }),
              },
            }),
          },
          ["composite"],
        ),
      },
      ["context"],
    ),
  },
});
const ajv = new Ajv({ allErrors: true, strict: false });
const passportValidator = ajv.compile<PassportInput>(passportInputSchema);
const contentValidator = ajv.compile<RulePassportContent>(
  object({
    ...passportInputSchema.properties,
    source: object({
      import_id: text,
      catalog_sha256: hash,
      origin_sha256: hash,
      row_sha256: hash,
      parameter_code: text,
      trigger: text,
    }),
  }),
);
const regressionValidator = ajv.compile<{
  schema_version: 1;
  fixtures: RegressionFixture[];
}>(regressionInputSchema);
export class MatrixReviewError extends Error {}
export function validatePassportInput(value: unknown): PassportInput {
  if (!passportValidator(value))
    throw new MatrixReviewError(
      `passport: ${ajv.errorsText(passportValidator.errors)}`,
    );
  if (new Set(value.branches.map((b) => b.id)).size !== value.branches.length)
    throw new MatrixReviewError("passport: повтор branch.id");
  return value;
}
export function validatePassportContent(value: unknown): RulePassportContent {
  if (!contentValidator(value))
    throw new MatrixReviewError("Сохранённый паспорт не проходит валидацию");
  return value;
}
export function validateRegressionInput(value: unknown): RegressionFixture[] {
  if (!regressionValidator(value))
    throw new MatrixReviewError(
      `regression: ${ajv.errorsText(regressionValidator.errors)}`,
    );
  if (new Set(value.fixtures.map((f) => f.id)).size !== value.fixtures.length)
    throw new MatrixReviewError("regression: повтор fixture.id");
  for (const fixture of value.fixtures) {
    if (fixture.context !== undefined)
      validateCompositeContext(fixture.context);
    for (const input of fixture.inputs)
      if (
        input.comparison_context !== undefined &&
        !validCompositeBinding(input.comparison_context)
      )
        throw new MatrixReviewError("regression: неверный comparison_context");
    if (
      fixture.expected.composite &&
      new Set(fixture.expected.composite.branches.map((b) => b.id)).size !==
        fixture.expected.composite.branches.length
    )
      throw new MatrixReviewError("regression: повтор composite branch.id");
  }
  return value.fixtures;
}
export function reviewHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
export const regressionEngines = {
  review: MATRIX_REVIEW_VERSION,
  extraction: EXTRACTION_ENGINE_VERSION,
  comparison: COMPARISON_ENGINE_VERSION,
  composite: COMPOSITE_ENGINE_VERSION,
};
export interface ReviewRule {
  id: string;
  parameterCode: string;
  version: number;
  plan: unknown;
  comparison: unknown;
  applicability: unknown;
}
export function reviewedRuleHash(
  rule: ReviewRule,
  passportHash: string,
): string {
  return reviewHash({
    id: rule.id,
    parameter_code: rule.parameterCode,
    version: rule.version,
    plan: rule.plan,
    comparison: rule.comparison,
    applicability: rule.applicability,
    passport_hash: passportHash,
  });
}
