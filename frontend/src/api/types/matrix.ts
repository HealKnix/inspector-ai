import { z } from "zod";
import { extractionItemSchema } from "./extraction";

export const matrixImportSchema = z.object({
  id: z.uuid(),
  sourceName: z.string(),
  sourceSha256: z.string(),
  originSha256: z.string(),
  rowCount: z.number().int(),
  importedBy: z.string().nullable(),
  importedAt: z.string(),
});

export const matrixRowSchema = z.object({
  id: z.uuid(),
  importId: z.uuid(),
  parameterId: z.number().int(),
  parameterCode: z.string(),
  pdSection: z.string(),
  name: z.string(),
  unit: z.string().nullable(),
  sourcePd: z.string().nullable(),
  sourceRd: z.string().nullable(),
  sourceId: z.string().nullable(),
  triggerText: z.string(),
  criticality: z.string().nullable(),
  matrixRow: z.number().int(),
  raw: z.record(z.string(), z.unknown()),
  rule_counts: z.record(z.string(), z.number()).optional(),
});

export const matrixRowsSchema = z.object({
  schema_version: z.literal(1),
  import: matrixImportSchema.nullable(),
  items: z.array(matrixRowSchema),
});

export const ruleVersionSchema = z.object({
  id: z.uuid(),
  parameterCode: z.string(),
  parameterId: z.number().int(),
  version: z.number().int(),
  status: z.enum(["draft", "approved", "rejected", "deprecated"]),
  plan: z.unknown(),
  comparison: z.unknown().nullable().optional(),
  applicability: z.unknown().nullable().optional(),
  note: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  approvedBy: z.string().nullable(),
  approvedAt: z.string().nullable(),
});

export const matrixRowDetailSchema = z.object({
  schema_version: z.literal(1),
  row: matrixRowSchema.omit({ rule_counts: true }),
  versions: z.array(ruleVersionSchema),
});

export const ruleMutationSchema = z.object({
  schema_version: z.literal(1),
  rule: ruleVersionSchema,
  warnings: z.array(z.string()).optional(),
});

export const dryRunResultSchema = z.object({
  schema_version: z.literal(1),
  rule_id: z.uuid(),
  results: z.array(
    z.object({
      file_id: z.uuid(),
      original_name: z.string(),
      artifact_id: z.uuid(),
      outcome: extractionItemSchema
        .omit({
          id: true,
          task_id: true,
          file_id: true,
          artifact_id: true,
          original_name: true,
          created_at: true,
          evidence: true,
        })
        .extend({ evidence: z.array(z.unknown()) }),
    }),
  ),
});

export const matrixSearchSchema = z.object({
  schema_version: z.literal(1),
  results: z.array(
    z.object({
      file_id: z.uuid(),
      original_name: z.string(),
      artifact_id: z.uuid(),
      windows: z.array(
        z.object({
          page_number: z.number().int(),
          sheet_label: z.string().nullable(),
          table_id: z.string().nullable(),
          lines: z.array(
            z.object({
              block_id: z.string().nullable(),
              text: z.string(),
            }),
          ),
        }),
      ),
    }),
  ),
});

export type MatrixImport = z.infer<typeof matrixImportSchema>;
export type MatrixRow = z.infer<typeof matrixRowSchema>;
export type RuleVersion = z.infer<typeof ruleVersionSchema>;
export type MatrixRowDetail = z.infer<typeof matrixRowDetailSchema>;
export type DryRunResult = z.infer<typeof dryRunResultSchema>;
export type MatrixSearch = z.infer<typeof matrixSearchSchema>;
