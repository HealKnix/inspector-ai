import { z } from "zod";

const text = z.string().min(1).max(2000).regex(/\S/);
const nullableText = text.nullable();
export const regressionCategories = [
  "positive",
  "negative",
  "boundary",
  "uncertain",
] as const;

export const passportInputSchema = z
  .object({
    schema_version: z.literal(1),
    matrix_row_id: z.uuid(),
    quantity: nullableText,
    applicability: nullableText,
    scope: nullableText,
    sources: z
      .array(z.enum(["PD", "RD", "ID"]))
      .min(1)
      .max(3),
    unit: nullableText,
    rounding: nullableText,
    branches: z
      .array(
        z
          .object({
            id: text,
            operator: text,
            version: text,
            basis_required: z.boolean(),
            basis: z
              .object({
                reference: text,
                version: text,
                locator: text,
                valid_from: nullableText,
                valid_to: nullableText,
              })
              .strict()
              .nullable(),
            categories: z
              .object({
                positive: nullableText,
                negative: nullableText,
                boundary: nullableText,
                uncertain: nullableText,
              })
              .strict(),
          })
          .strict(),
      )
      .min(1)
      .max(65),
  })
  .strict();

export const rulePassportSchema = z.object({
  id: z.uuid(),
  ruleVersionId: z.uuid(),
  matrixRowId: z.uuid(),
  revision: z.number().int().positive(),
  content: passportInputSchema.extend({
    source: z.object({
      import_id: z.uuid(),
      catalog_sha256: z.string(),
      origin_sha256: z.string(),
      row_sha256: z.string(),
      parameter_code: z.string(),
      trigger: z.string(),
    }),
  }),
  contentHash: z.string(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
});

export const regressionReportSchema = z.object({
  id: z.uuid(),
  ruleVersionId: z.uuid(),
  passportId: z.uuid(),
  ruleHash: z.string(),
  fixturesHash: z.string(),
  engineFingerprint: z.string(),
  reportHash: z.string(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  report: z.object({
    schema_version: z.literal(1),
    rule_hash: z.string(),
    passport_hash: z.string(),
    fixtures_hash: z.string(),
    engine_fingerprint: z.string(),
    engines: z.record(z.string(), z.string()),
    passed: z.boolean(),
    blockers: z.array(z.string()),
    cases: z.array(
      z.object({
        id: z.string(),
        branch_id: z.string(),
        category: z.enum(regressionCategories),
        passed: z.boolean(),
        errors: z.array(z.string()),
        provenance: z.object({
          kind: z.enum(["synthetic", "curated"]),
          reference: z.string(),
          permission: z.string().nullable(),
        }),
        expected: z.unknown(),
        actual: z.unknown(),
      }),
    ),
    waivers: z.array(
      z.object({
        branch_id: z.string(),
        category: z.enum(regressionCategories),
        reason: z.string().nullable(),
      }),
    ),
    quality: z.object({
      synthetic_cases: z.number().int(),
      curated_cases: z.number().int(),
      corpus_accuracy: z.number().nullable(),
      statement: z.string(),
    }),
  }),
});

export const matrixReviewSchema = z.object({
  schema_version: z.literal(1),
  rule_id: z.uuid(),
  passports: z.array(rulePassportSchema),
  reports: z.array(regressionReportSchema),
  legacy_without_review: z.boolean(),
  approval: z
    .object({ eligible: z.boolean(), reason: z.string().nullable() })
    .optional(),
});
export const matrixReviewContractSchema = z.object({
  schema_version: z.literal(1),
  passport: z.record(z.string(), z.unknown()),
  regression: z.record(z.string(), z.unknown()),
  engines: z.record(z.string(), z.string()).optional(),
});
export const passportMutationSchema = z.object({
  schema_version: z.literal(1),
  passport: rulePassportSchema,
  reused: z.boolean(),
});
export const regressionMutationSchema = z.object({
  schema_version: z.literal(1),
  report: regressionReportSchema,
  reused: z.boolean(),
});

// The server's advertised JSON Schema validates each artifact and expected locator.
// Keep the uploaded payload intact; never substitute an observed result for an expectation.
export const regressionInputSchema = z
  .object({
    schema_version: z.literal(1),
    fixtures: z.array(z.record(z.string(), z.unknown())).min(1).max(260),
  })
  .strict();
export type PassportInput = z.infer<typeof passportInputSchema>;
export type MatrixReview = z.infer<typeof matrixReviewSchema>;
export type RulePassport = z.infer<typeof rulePassportSchema>;
export type RegressionReport = z.infer<typeof regressionReportSchema>;
export type RegressionInput = z.infer<typeof regressionInputSchema>;
