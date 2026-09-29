import { z } from "zod";

/**
 * Section-first LLM comparison wire schemas (change
 * add-section-context-analysis). Mirrors the backend contracts in
 * backend/src/modules/extraction/section-contract.ts (results/task) and
 * backend/src/modules/verification/section-findings.ts (frozen finding
 * snapshot). Provider/model internals stay server-side; the inspector sees
 * facts, questions, missing context, coverage, sections and citations.
 */

export const sectionRoleSchema = z.enum(["reference", "actual"]);
export type SectionRole = z.infer<typeof sectionRoleSchema>;

export const sectionAssessmentSchema = z.enum([
  "potential_difference",
  "proposed_agreement",
  "insufficient_context",
]);
export type SectionAssessment = z.infer<typeof sectionAssessmentSchema>;

const coordinate = z.number().min(0).max(1);
const bboxSchema = z.tuple([coordinate, coordinate, coordinate, coordinate]);

const revisionReferenceSchema = z.object({
  document_id: z.string(),
  revision_id: z.string(),
});

const worksPeriodSchema = z.object({
  from: z.string().nullable(),
  to: z.string().nullable(),
});

/** Physical identity of one immutable source stream (no text inside). */
export const sectionSourceInfoSchema = z.object({
  source_ref: z.string(),
  role: sectionRoleSchema,
  document_id: z.string(),
  revision_id: z.string(),
  document_stage: z.string().nullable(),
  file_id: z.string(),
  artifact_id: z.string(),
  artifact_sha256: z.string(),
  source_sha256: z.string(),
  selection_hash: z.string().nullable(),
  pages: z.array(z.number().int()),
});
export type SectionSourceInfo = z.infer<typeof sectionSourceInfoSchema>;

/** Server-derived locator plus the exact quote the model cited. */
export const sectionEvidenceSchema = z.object({
  source_ref: z.string(),
  role: sectionRoleSchema,
  section_id: z.string(),
  document_id: z.string(),
  revision_id: z.string(),
  file_id: z.string(),
  artifact_id: z.string(),
  page_number: z.number().int().positive(),
  sheet_label: z.string().nullable(),
  block_id: z.string().nullable(),
  table_id: z.string().nullable(),
  table_row: z.number().int().nullable(),
  table_column: z.number().int().nullable(),
  quote: z.string(),
  bbox: bboxSchema.nullable(),
  structural_path: z.string().nullable(),
});
export type SectionEvidence = z.infer<typeof sectionEvidenceSchema>;

export const discoveredSectionSchema = z.object({
  section_id: z.string(),
  source_ref: z.string(),
  title: z.string(),
  start_block_id: z.string(),
  end_block_id: z.string(),
  /** Server-derived physical page bounds — present in new output, absent
   *  only in legacy payloads; the UI must not infer them from citations. */
  start_page_number: z.number().int().positive().optional(),
  end_page_number: z.number().int().positive().optional(),
  parameter_codes: z.array(z.string()),
});
export type DiscoveredSection = z.infer<typeof discoveredSectionSchema>;

export const sectionCoverageSchema = z.object({
  complete: z.boolean(),
  missing: z.array(z.string()),
});
export type SectionCoverage = z.infer<typeof sectionCoverageSchema>;

export const sectionParameterResultSchema = z.object({
  parameter_code: z.string(),
  assessment: sectionAssessmentSchema,
  fact: z.string().nullable(),
  evidence: z.array(sectionEvidenceSchema),
  missing_context: z.array(z.string()),
  /** Row-scoped coverage — new output fills it; absent rows mean the
   *  context-level coverage applies. A complete row stays reviewable even
   *  when an unrelated row in the same context is unanswered. */
  coverage: sectionCoverageSchema.optional(),
  question_for_inspector: z.string().nullable(),
});
export type SectionParameterResult = z.infer<
  typeof sectionParameterResultSchema
>;

export const sectionContextResultSchema = z.object({
  context_id: z.string(),
  scope: z.string(),
  works_period: worksPeriodSchema,
  reference: revisionReferenceSchema.nullable(),
  actual: revisionReferenceSchema,
  sources: z.array(sectionSourceInfoSchema),
  sections: z.array(discoveredSectionSchema),
  parameters: z.array(sectionParameterResultSchema),
  coverage: sectionCoverageSchema,
});
export type SectionContextResult = z.infer<typeof sectionContextResultSchema>;

export const sectionAnalysisBasisSchema = z.object({
  matrix_identity: z.string(),
  model: z.string(),
  discovery_prompt_version: z.string(),
  analysis_prompt_version: z.string(),
});

export const sectionAnalysisFailureSchema = z.object({
  stage: z.enum(["discovery", "analysis"]),
  context_id: z.string(),
  code: z.string(),
  retryable: z.boolean(),
});

export const sectionAnalysisOutputSchema = z.object({
  schema_version: z.literal(1),
  engine: z.string(),
  analysis_basis: sectionAnalysisBasisSchema,
  contexts: z.array(sectionContextResultSchema),
  skipped_contexts: z.array(
    z.object({ context_id: z.string(), reason: z.string() }),
  ),
  calls_used: z.number().int().nonnegative(),
  failures: z.array(sectionAnalysisFailureSchema),
});
export type SectionAnalysisOutput = z.infer<typeof sectionAnalysisOutputSchema>;

const sectionTaskStateSchema = z.enum([
  "queued",
  "processing",
  "succeeded",
  "failed",
]);

export const sectionAnalysisTaskSchema = z.object({
  id: z.uuid(),
  state: sectionTaskStateSchema,
  error_code: z.string().nullable(),
  cycle: z.number().int(),
  attempts: z.number().int(),
  fingerprint: z.string(),
  config_fingerprint: z.string(),
  matrix_import_id: z.string(),
  resolved_input_hash: z.string(),
  source_fingerprint: z.string(),
  parameter_codes: z.array(z.string()),
  /** Server-side verdict that the stored result can no longer be a basis —
   *  rotated run, changed matrix/config fingerprint or superseded sources. */
  stale: z.boolean(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
});
export type SectionAnalysisTask = z.infer<typeof sectionAnalysisTaskSchema>;

/** GET /v1/objects/:id/section-analysis — selected analysis basis + result. */
export const sectionAnalysisStatusSchema = z.object({
  schema_version: z.literal(1),
  enabled: z.boolean(),
  process_id: z.string().nullable(),
  run_id: z.string().nullable(),
  resolved_input_hash: z.string().nullable(),
  current: z.boolean(),
  active: z.boolean(),
  poll_after_ms: z.number().int().positive(),
  task: sectionAnalysisTaskSchema.nullable(),
  results: sectionAnalysisOutputSchema.nullable(),
});
export type SectionAnalysisStatus = z.infer<typeof sectionAnalysisStatusSchema>;

export const sectionAnalysisStartResponseSchema = z.object({
  schema_version: z.literal(1),
  request_id: z.uuid(),
  task: sectionAnalysisTaskSchema,
});
export type SectionAnalysisStartResponse = z.infer<
  typeof sectionAnalysisStartResponseSchema
>;

export interface SectionAnalysisStartRequest {
  request_id: string;
  expected_run_id: string;
  parameter_codes?: string[];
}

/** Matrix row frozen at admission — the finding's own name/trigger/unit. */
export const sectionMatrixRowSchema = z.object({
  parameter_code: z.string(),
  name: z.string(),
  unit: z.string().nullable(),
  source_pd: z.string().nullable(),
  source_rd: z.string().nullable(),
  source_id: z.string().nullable(),
  trigger: z.string(),
});
export type SectionMatrixRow = z.infer<typeof sectionMatrixRowSchema>;

/**
 * Versioned payload exposed as finding.section_analysis (frozen at
 * Finding.evidenceSnapshot.section_analysis on the backend).
 */
export const sectionAnalysisSnapshotSchema = z.object({
  schema_version: z.literal(1),
  parameter_code: z.string(),
  context_id: z.string(),
  assessment: sectionAssessmentSchema,
  fact: z.string().nullable(),
  question_for_inspector: z.string().nullable(),
  missing_context: z.array(z.string()),
  evidence: z.array(sectionEvidenceSchema),
  coverage: sectionCoverageSchema,
  context: z.object({
    context_id: z.string(),
    scope: z.string(),
    works_period: worksPeriodSchema,
    reference: revisionReferenceSchema.nullable(),
    actual: revisionReferenceSchema,
  }),
  sources: z.array(sectionSourceInfoSchema),
  sections: z.array(discoveredSectionSchema),
  matrix: sectionMatrixRowSchema.nullable(),
  analysis_basis: sectionAnalysisBasisSchema,
  task_fingerprint: z.string(),
  result_fingerprint: z.string(),
});
export type SectionAnalysisSnapshot = z.infer<
  typeof sectionAnalysisSnapshotSchema
>;
