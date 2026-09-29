import type {
  SectionAnalysisOutput,
  SectionAnalysisSnapshot,
  SectionAnalysisStatus,
  SectionAnalysisTask,
  SectionContextResult,
  SectionEvidence,
  SectionMatrixRow,
  SectionSourceInfo,
} from "./section-analysis";

// Synthetic source identities for isolated client tests — no real
// documents, model output or provider internals.
export const sectionObjectId = "11111111-1111-4111-8111-111111111111";
export const sectionProcessId = "22222222-2222-4222-8222-222222222222";
export const sectionRunId = "33333333-3333-4333-8333-333333333333";
export const sectionTaskId = "44444444-4444-4444-8444-444444444444";
export const sectionRequestId = "55555555-5555-4555-8555-555555555555";
export const sectionMatrixImportId = "66666666-6666-4666-8666-666666666666";

const referenceFileId = "77777777-7777-4777-8777-777777777777";
const actualFileId = "88888888-8888-4888-8888-888888888888";
const referenceArtifactId = "99999999-9999-4999-8999-999999999999";
const actualArtifactId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

export const sectionReferenceSource: SectionSourceInfo = {
  source_ref: "ref",
  role: "reference",
  document_id: "doc-pd",
  revision_id: "rev-pd-1",
  document_stage: "PD",
  file_id: referenceFileId,
  artifact_id: referenceArtifactId,
  artifact_sha256: "a".repeat(64),
  source_sha256: "b".repeat(64),
  selection_hash: "c".repeat(64),
  pages: [3],
};
export const sectionActualSource: SectionSourceInfo = {
  source_ref: "act",
  role: "actual",
  document_id: "doc-rd",
  revision_id: "rev-rd-2",
  document_stage: "RD",
  file_id: actualFileId,
  artifact_id: actualArtifactId,
  artifact_sha256: "d".repeat(64),
  source_sha256: "e".repeat(64),
  selection_hash: null,
  pages: [5],
};

export const sectionReferenceEvidence: SectionEvidence = {
  source_ref: "ref",
  role: "reference",
  section_id: "sec-pd-1",
  document_id: "doc-pd",
  revision_id: "rev-pd-1",
  file_id: referenceFileId,
  artifact_id: referenceArtifactId,
  page_number: 3,
  sheet_label: "Л-3",
  block_id: "blk-pd-7",
  table_id: null,
  table_row: null,
  table_column: null,
  quote: "Класс бетона В25",
  bbox: [0.1, 0.2, 0.4, 0.3],
  structural_path: null,
};
export const sectionActualEvidence: SectionEvidence = {
  source_ref: "act",
  role: "actual",
  section_id: "sec-rd-1",
  document_id: "doc-rd",
  revision_id: "rev-rd-2",
  file_id: actualFileId,
  artifact_id: actualArtifactId,
  page_number: 5,
  sheet_label: "Л-5",
  block_id: "blk-rd-11",
  table_id: null,
  table_row: null,
  table_column: null,
  quote: "Класс бетона В30",
  bbox: null,
  structural_path: null,
};

export const sectionMatrixRow: SectionMatrixRow = {
  parameter_code: "P001",
  name: "Класс бетона несущих конструкций",
  unit: null,
  source_pd: "ПД",
  source_rd: "РД",
  source_id: null,
  trigger: "Для всех несущих конструкций",
};

export const sectionSnapshot: SectionAnalysisSnapshot = {
  schema_version: 1,
  parameter_code: "P001",
  context_id: "ctx-1",
  assessment: "potential_difference",
  fact: "В эталонном разделе указан класс В25, в проверяемом — В30.",
  question_for_inspector: "Подтверждено ли согласованное изменение класса?",
  missing_context: [],
  evidence: [sectionReferenceEvidence, sectionActualEvidence],
  coverage: { complete: true, missing: [] },
  context: {
    context_id: "ctx-1",
    scope: "Фундаменты",
    works_period: { from: "2026-01", to: "2026-03" },
    reference: { document_id: "doc-pd", revision_id: "rev-pd-1" },
    actual: { document_id: "doc-rd", revision_id: "rev-rd-2" },
  },
  sources: [sectionReferenceSource, sectionActualSource],
  sections: [
    {
      section_id: "sec-pd-1",
      source_ref: "ref",
      title: "3. Конструктивные решения",
      start_block_id: "blk-pd-1",
      end_block_id: "blk-pd-9",
      start_page_number: 3,
      end_page_number: 4,
      parameter_codes: ["P001"],
    },
    {
      section_id: "sec-rd-1",
      source_ref: "act",
      title: "3.1 Несущие конструкции",
      start_block_id: "blk-rd-1",
      end_block_id: "blk-rd-15",
      start_page_number: 5,
      end_page_number: 6,
      parameter_codes: ["P001"],
    },
  ],
  matrix: sectionMatrixRow,
  analysis_basis: {
    matrix_identity: "matrix-1",
    model: "test-model",
    discovery_prompt_version: "d1",
    analysis_prompt_version: "a1",
  },
  task_fingerprint: "task-fp",
  result_fingerprint: "result-fp",
};

export const sectionContextResult: SectionContextResult = {
  context_id: "ctx-1",
  scope: "Фундаменты",
  works_period: { from: "2026-01", to: "2026-03" },
  reference: { document_id: "doc-pd", revision_id: "rev-pd-1" },
  actual: { document_id: "doc-rd", revision_id: "rev-rd-2" },
  sources: [sectionReferenceSource, sectionActualSource],
  sections: sectionSnapshot.sections,
  parameters: [
    {
      parameter_code: "P001",
      assessment: "potential_difference",
      fact: sectionSnapshot.fact,
      evidence: [sectionReferenceEvidence, sectionActualEvidence],
      missing_context: [],
      question_for_inspector: sectionSnapshot.question_for_inspector,
    },
  ],
  coverage: { complete: true, missing: [] },
};

export const sectionResults: SectionAnalysisOutput = {
  schema_version: 1,
  engine: "section-llm-v1",
  analysis_basis: sectionSnapshot.analysis_basis,
  contexts: [sectionContextResult],
  skipped_contexts: [],
  calls_used: 3,
  failures: [],
};

export const sectionTask: SectionAnalysisTask = {
  id: sectionTaskId,
  state: "succeeded",
  error_code: null,
  cycle: 1,
  attempts: 1,
  fingerprint: "fp-task",
  config_fingerprint: "fp-config",
  matrix_import_id: sectionMatrixImportId,
  resolved_input_hash: "f".repeat(64),
  source_fingerprint: "a1b2c3".repeat(8),
  parameter_codes: [],
  stale: false,
  created_at: "2026-09-28T10:00:00Z",
  completed_at: "2026-09-28T10:01:00Z",
};

export const sectionStatus: SectionAnalysisStatus = {
  schema_version: 1,
  enabled: true,
  process_id: sectionProcessId,
  run_id: sectionRunId,
  resolved_input_hash: "f".repeat(64),
  current: true,
  active: false,
  poll_after_ms: 2000,
  task: sectionTask,
  results: sectionResults,
};

export const sectionStatusDisabled: SectionAnalysisStatus = {
  ...sectionStatus,
  enabled: false,
  task: null,
  results: null,
};
