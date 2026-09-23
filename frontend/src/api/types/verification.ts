import { z } from "zod";

export const apiFindingStatusSchema = z.enum([
  "CANDIDATE",
  "CONFIRMED_VIOLATION",
  "NEGATIVE_VERIFIED",
  "CLARIFICATION_REQUIRED",
  "MISSING_EVIDENCE",
  "NOT_COMPARABLE",
  "NOT_APPLICABLE",
]);

export type ApiFindingStatus = z.infer<typeof apiFindingStatusSchema>;

export const decisionActionSchema = z.enum([
  "confirm",
  "reject",
  "clarify",
  "reopen",
]);

const memberRefSchema = z.object({
  extraction_id: z.uuid(),
  file_id: z.uuid(),
  value: z.union([z.number(), z.string()]),
  value_raw: z.string().nullable(),
  unit: z.string().nullable(),
});

const comparisonPairSchema = z.object({
  expected_extraction_id: z.uuid().nullable(),
  actual_extraction_id: z.uuid().nullable(),
  result: z.enum(["match", "mismatch", "not_comparable"]),
  delta: z.number().nullable(),
  delta_pct: z.number().nullable(),
  detail: z.string().nullable(),
});

export const groupVerdictSchema = z.object({
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
  spec: z.unknown().nullable(),
  expected: z.array(memberRefSchema).nullable(),
  actual: z.array(memberRefSchema).nullable(),
  pairs: z.array(comparisonPairSchema),
  warnings: z.array(z.string()),
  evaluated_at: z.string(),
});

export type GroupVerdict = z.infer<typeof groupVerdictSchema>;

export const findingItemSchema = z.object({
  id: z.uuid(),
  parameter_code: z.string(),
  parameter_name: z.string().nullish(),
  scope_key: z.string(),
  status: apiFindingStatusSchema,
  risk: z.string().nullable(),
  reason_code: z.string().nullable(),
  comment: z.string().nullable(),
  decided_at: z.string().nullable(),
  finding_version: z.number().int().positive(),
  gate_reasons: z.array(z.string()).nullable(),
  verdict: groupVerdictSchema.nullable(),
});

export type ApiFinding = z.infer<typeof findingItemSchema>;

const evidenceFragmentSchema = z.object({
  extractionId: z.uuid(),
  fileId: z.uuid(),
  pageNumber: z.number().int().positive(),
  sheetLabel: z.string().nullable(),
  blockId: z.string().nullable(),
  quote: z.string(),
  bbox: z.array(z.number()).nullable(),
});

export type EvidenceFragment = z.infer<typeof evidenceFragmentSchema>;

const groupMemberSchema = z.object({
  extraction_id: z.uuid(),
  file_id: z.uuid(),
  stage: z.string().nullable(),
  role: z.enum(["expected", "actual", "unknown"]),
  status: z.string(),
  value: z.union([z.number(), z.string()]).nullable(),
  value_raw: z.string().nullable(),
  unit: z.string().nullable(),
  evidence: z.array(evidenceFragmentSchema),
});

export type GroupMember = z.infer<typeof groupMemberSchema>;

const findingDecisionSchema = z.object({
  id: z.uuid(),
  actor_id: z.string(),
  action: decisionActionSchema,
  from_status: apiFindingStatusSchema,
  to_status: apiFindingStatusSchema,
  reason_code: z.string().nullable(),
  comment: z.string().nullable(),
  created_at: z.string(),
});

export type ApiFindingDecision = z.infer<typeof findingDecisionSchema>;

export const findingsResponseSchema = z.object({
  schema_version: z.literal(1),
  object_id: z.uuid(),
  protocol_id: z.uuid().nullable(),
  items: z.array(findingItemSchema),
  findings_absent_reason: z.string().nullable(),
});

export type FindingsResponse = z.infer<typeof findingsResponseSchema>;

export const findingDetailSchema = findingItemSchema.extend({
  protocol_version: z.number().int(),
  members: z.array(groupMemberSchema),
  decisions: z.array(findingDecisionSchema),
});

export type ApiFindingDetail = z.infer<typeof findingDetailSchema>;

export const findingDetailResponseSchema = z.object({
  schema_version: z.literal(1),
  object_id: z.uuid(),
  finding: findingDetailSchema,
});

const protocolVersionSchema = z.object({
  id: z.uuid(),
  version: z.number().int(),
  status: z.string(),
  scenario: z.string(),
  created_at: z.string(),
  finalized_at: z.string().nullable(),
  findings: z.number().int(),
});

export const protocolResponseSchema = z.object({
  schema_version: z.literal(1),
  object_id: z.uuid(),
  process_status: z.string(),
  protocol: protocolVersionSchema.nullable(),
  versions: z.array(protocolVersionSchema),
  protocol_absent_reason: z.string().nullable(),
});

export type ProtocolResponse = z.infer<typeof protocolResponseSchema>;

export const generateResponseSchema = z.object({
  schema_version: z.literal(1),
  object_id: z.uuid(),
  protocol_id: z.uuid(),
  protocol_version: z.number().int(),
  status: z.string(),
  findings: z.number().int(),
  reused: z.boolean(),
});

export const decisionRequestSchema = z.object({
  request_id: z.uuid(),
  action: decisionActionSchema,
  finding_version: z.number().int().positive(),
  reason_code: z.string().optional(),
  comment: z.string().optional(),
});

export type DecisionRequest = z.infer<typeof decisionRequestSchema>;

export const decisionResponseSchema = z.object({
  schema_version: z.literal(1),
  object_id: z.uuid(),
  finding: findingItemSchema,
  process_status: z.string(),
  replayed: z.boolean(),
});

export const finalizeResponseSchema = z.object({
  schema_version: z.literal(1),
  object_id: z.uuid(),
  protocol_id: z.uuid(),
  protocol_version: z.number().int(),
  status: z.string(),
  process_status: z.string(),
});
