import { z } from "zod";

const stageSchema = z.enum(["PD", "RD", "ID"]);

const requirementSourceSchema = z.object({
  norm_ref: z.string().optional(),
  framework_code: z.string().optional(),
  file_id: z.string().optional(),
  manual: z.boolean().optional(),
});

const packageRequirementSchema = z.object({
  id: z.string(),
  code: z.string(),
  stage: stageSchema,
  kind_code: z.string(),
  title: z.string(),
  scope: z.record(z.string(), z.unknown()).nullable(),
  quantity: z.object({
    min: z.number().int().nonnegative(),
    per: z.enum(["object", "list_item"]).nullable(),
  }),
  alternatives: z.record(z.string(), z.unknown()).nullable(),
  origin: z.string(),
  excluded: z.boolean(),
  exclusion_reason: z.string().nullable(),
  source: requirementSourceSchema.nullable(),
});

const packageListItemSchema = z.object({
  id: z.string(),
  list_kind: z.string(),
  item_key: z.string(),
  title: z.string(),
  source: z.record(z.string(), z.unknown()).nullable(),
});

const expectedPackageSchema = z.object({
  version: z.number().int().positive(),
  status: z.enum(["proposed", "confirmed"]),
  framework_version: z.number().int().positive(),
  attributes: z.record(z.string(), z.unknown()),
  confirmed_by: z.string().nullable(),
  confirmed_at: z.string().nullable(),
  basis: z.string().nullable(),
  list_items: z.array(packageListItemSchema),
  requirements: z.array(packageRequirementSchema),
  requirements_total: z.number().int().nonnegative(),
});

export const expectedPackageResponseSchema = z.object({
  schema_version: z.literal(1),
  object_id: z.string(),
  package: expectedPackageSchema.nullable(),
  package_absent_reason: z.string().nullable(),
});

export const packageMutationResponseSchema = z.object({
  schema_version: z.literal(1),
  object_id: z.string(),
  package_version: z.number().int().positive(),
  status: z.string().optional(),
  requirements: z.number().optional(),
  list_items: z.number().optional(),
  extracted_candidates: z.number().optional(),
});

const stageStatusSchema = z.object({
  status: z.enum(["UPLOADED", "PARTIAL", "MISSING"]),
  applicable: z.number().int().nonnegative(),
  fulfilled: z.number().int().nonnegative(),
  missing: z.number().int().nonnegative(),
  unverifiable: z.number().int().nonnegative(),
});

const requirementOutcomeSchema = z.object({
  requirement_id: z.string(),
  code: z.string(),
  title: z.string(),
  stage: stageSchema,
  scope: z.record(z.string(), z.unknown()).nullable(),
  outcome: z.enum(["fulfilled", "missing", "not_applicable", "unverifiable"]),
  reasons: z.array(z.string()),
  matched: z.array(
    z.object({
      file_id: z.string(),
      document_id: z.string().optional(),
      revision_id: z.string().optional(),
    }),
  ),
  missing_parts: z.array(z.string()),
});

const evaluationSchema = z.object({
  stages: z.object({
    PD: stageStatusSchema.nullable(),
    RD: stageStatusSchema.nullable(),
    ID: stageStatusSchema.nullable(),
  }),
  scenario: z.enum([
    "FULL",
    "PD_RD_ONLY",
    "PD_ID_ONLY",
    "RD_ID_ONLY",
    "SINGLE_ONLY",
    "PARTIALLY_LOADED",
  ]),
  requirements: z.array(requirementOutcomeSchema),
  counts: z.object({
    applicable: z.number().int().nonnegative(),
    fulfilled: z.number().int().nonnegative(),
    missing: z.number().int().nonnegative(),
    unverifiable: z.number().int().nonnegative(),
    not_applicable: z.number().int().nonnegative(),
  }),
});

export const completenessResultSchema = z.object({
  schema_version: z.literal(1),
  object_id: z.string(),
  process_id: z.string().nullable(),
  run_id: z.string().nullable(),
  resolved_input_hash: z.string().nullable().optional(),
  package_version: z.number().int().positive().nullable(),
  framework_version: z.number().int().positive().nullable(),
  evaluated_at: z.string().nullable(),
  evaluation: evaluationSchema.nullable(),
  evaluation_absent_reason: z.string().nullable(),
});

export type ExpectedPackage = z.infer<typeof expectedPackageSchema>;
export type ExpectedPackageResponse = z.infer<
  typeof expectedPackageResponseSchema
>;
export type PackageRequirement = z.infer<typeof packageRequirementSchema>;
export type PackageListItem = z.infer<typeof packageListItemSchema>;
export type CompletenessResult = z.infer<typeof completenessResultSchema>;
export type RequirementOutcome = z.infer<typeof requirementOutcomeSchema>;
export type Evaluation = z.infer<typeof evaluationSchema>;
