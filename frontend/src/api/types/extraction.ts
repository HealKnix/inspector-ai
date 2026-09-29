import { z } from "zod";
import {
  compositeSpecSchema,
  compositeTraceSchema,
} from "./composite-comparison";

const coordinate = z.number().min(0).max(1);

export const extractionEvidenceSchema = z.object({
  extraction_id: z.uuid(),
  file_id: z.uuid(),
  artifact_id: z.uuid(),
  page_number: z.number().int().positive(),
  sheet_label: z.string().nullable(),
  block_id: z.string().nullable(),
  table_id: z.string().nullable(),
  table_row: z.number().int().nullable(),
  table_column: z.number().int().nullable(),
  quote: z.string(),
  bbox: z.tuple([coordinate, coordinate, coordinate, coordinate]).nullable(),
  structural_path: z.string().nullable(),
});

const extractionItemStatusSchema = z.enum([
  "extracted",
  "ambiguous",
  "no_evidence",
  "unreadable",
  "unsupported",
]);

const extractionAlternativeSchema = z.object({
  numerical: z.record(z.string(), z.unknown()).nullish(),
  value_raw: z.string().nullable(),
  value: z.union([z.number(), z.string()]).nullable(),
  unit: z.string().nullable(),
});

export const extractionItemSchema = z.object({
  numerical: z.record(z.string(), z.unknown()).nullish(),
  id: z.uuid(),
  task_id: z.uuid(),
  artifact_id: z.uuid(),
  file_id: z.uuid(),
  original_name: z.string(),
  parameter_code: z.string(),
  rule_version_id: z.uuid(),
  status: extractionItemStatusSchema,
  stage: z.enum(["PD", "RD", "ID"]).nullable(),
  value_raw: z.string().nullable(),
  value: z.union([z.number(), z.string()]).nullable(),
  unit: z.string().nullable(),
  alternatives: z.array(extractionAlternativeSchema).nullable(),
  reason: z.string().nullable(),
  created_at: z.string(),
  evidence: z.array(extractionEvidenceSchema),
});

export const extractionTaskSchema = z.object({
  task_id: z.uuid(),
  artifact_id: z.uuid(),
  file_id: z.uuid(),
  original_name: z.string(),
  state: z.enum(["queued", "processing", "succeeded", "failed"]),
  error_code: z.string().nullable(),
});

export const extractionStatusSchema = z.object({
  schema_version: z.literal(1),
  ruleset_fingerprint: z.string().nullable(),
  active: z.boolean(),
  poll_after_ms: z.number().int().positive(),
  items: z.array(extractionItemSchema),
  tasks: z.array(extractionTaskSchema),
});

const evidenceMemberSchema = z.object({
  numerical: z.record(z.string(), z.unknown()).nullish(),
  extraction_id: z.uuid(),
  file_id: z.uuid(),
  artifact_id: z.uuid(),
  stage: z.enum(["PD", "RD", "ID"]).nullable(),
  role: z.enum(["expected", "actual", "unknown"]),
  status: extractionItemStatusSchema,
  value: z.union([z.number(), z.string()]).nullable(),
  value_raw: z.string().nullable(),
  unit: z.string().nullable(),
  rule_version_id: z.uuid(),
});

const scalarComparisonSpecSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("equals"),
    numerical_policy: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    kind: z.literal("numeric_delta"),
    tolerance_abs: z.union([z.number(), z.string()]).optional(),
    tolerance_pct: z.union([z.number(), z.string()]).optional(),
    numerical_policy: z.record(z.string(), z.unknown()).optional(),
    inclusive: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("no_decrease"),
    numerical_policy: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    kind: z.literal("no_increase"),
    numerical_policy: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    kind: z.literal("threshold"),
    min: z.union([z.number(), z.string()]).optional(),
    max: z.union([z.number(), z.string()]).optional(),
    numerical_policy: z.record(z.string(), z.unknown()).optional(),
    min_inclusive: z.boolean().optional(),
    max_inclusive: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("ordered_category"),
    direction: z.enum(["no_decrease", "no_increase"]),
    map_version: z.string(),
    ranks: z.record(z.string(), z.number()),
    basis: z.object({
      reference: z.string(),
      version: z.string(),
      locator: z.string(),
    }),
  }),
]);

const verdictStatusSchema = z.enum([
  "match",
  "discrepancy",
  "expected_missing",
  "actual_missing",
  "expected_ambiguous",
  "actual_ambiguous",
  "not_comparable",
  "no_comparison",
]);

const verdictMemberSchema = z.object({
  extraction_id: z.uuid(),
  file_id: z.uuid(),
  value: z.union([z.number(), z.string()]),
  value_raw: z.string().nullable(),
  unit: z.string().nullable(),
});

const comparisonPairSchema = z.object({
  trace: z.record(z.string(), z.unknown()).optional(),
  expected_extraction_id: z.uuid().nullable(),
  actual_extraction_id: z.uuid().nullable(),
  result: z.enum(["match", "mismatch", "not_comparable"]),
  delta: z.number().nullable(),
  delta_pct: z.number().nullable(),
  detail: z.string().nullable(),
});

const groupVerdictSchema = z.object({
  composite: compositeTraceSchema.optional(),
  rule_basis: z.record(z.string(), z.unknown()).optional(),
  engine: z.string(),
  status: verdictStatusSchema,
  spec: z.union([scalarComparisonSpecSchema, compositeSpecSchema]).nullable(),
  expected: z.array(verdictMemberSchema).nullable(),
  actual: z.array(verdictMemberSchema).nullable(),
  pairs: z.array(comparisonPairSchema),
  warnings: z.array(z.string()),
  evaluated_at: z.string(),
});

export const evidenceGroupSchema = z.object({
  id: z.uuid(),
  parameter_code: z.string(),
  scope_key: z.string(),
  ruleset_hash: z.string(),
  members: z.array(evidenceMemberSchema),
  verdict: groupVerdictSchema.nullable(),
  updated_at: z.string(),
});

export const evidenceGroupsSchema = z.object({
  schema_version: z.literal(1),
  items: z.array(evidenceGroupSchema),
});

export type ExtractionEvidence = z.infer<typeof extractionEvidenceSchema>;
export type ExtractionItem = z.infer<typeof extractionItemSchema>;
export type ExtractionTask = z.infer<typeof extractionTaskSchema>;
export type ExtractionStatus = z.infer<typeof extractionStatusSchema>;
export type EvidenceMember = z.infer<typeof evidenceMemberSchema>;
export type EvidenceGroup = z.infer<typeof evidenceGroupSchema>;
export type GroupVerdict = z.infer<typeof groupVerdictSchema>;
export type VerdictStatus = z.infer<typeof verdictStatusSchema>;
export type ComparisonPair = z.infer<typeof comparisonPairSchema>;
export type VerdictMember = z.infer<typeof verdictMemberSchema>;
