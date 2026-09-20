import { z } from "zod";

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
  value_raw: z.string().nullable(),
  value: z.union([z.number(), z.string()]).nullable(),
  unit: z.string().nullable(),
});

export const extractionItemSchema = z.object({
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

export const evidenceGroupSchema = z.object({
  id: z.uuid(),
  parameter_code: z.string(),
  scope_key: z.string(),
  ruleset_hash: z.string(),
  members: z.array(evidenceMemberSchema),
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
