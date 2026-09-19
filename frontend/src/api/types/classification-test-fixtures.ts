import type {
  ClassificationFile,
  ClassificationResult,
  ClassificationStatus,
} from "./classification";
import { parsedFile } from "./parsing-test-fixtures";

// Synthetic responses for client contract and interaction tests, not a quality benchmark.
export const classificationResult: ClassificationResult = {
  schema_version: 1,
  stage: "PD",
  document_kind: "Синтетический том",
  method: "rules",
  needs_review: false,
  reasons: [],
  evidence: [
    {
      page_number: 1,
      block_id: "block-1",
      quote: "ПРОЕКТНАЯ ДОКУМЕНТАЦИЯ",
      bbox: [0.1, 0.1, 0.5, 0.2],
      structural_path: null,
    },
  ],
  candidates: [],
  versions: {
    classifier: "test",
    rules: "test",
    context: "test",
    prompt: "test",
    model: null,
  },
};
export const classifiedFile: ClassificationFile = {
  file_id: parsedFile.file_id,
  process_id: parsedFile.process_id,
  run_id: parsedFile.run_id,
  artifact_id: parsedFile.artifact_id!,
  original_name: parsedFile.original_name,
  task_id: "77777777-7777-4777-8777-777777777777",
  state: "succeeded",
  can_retry: true,
  error_code: null,
  result: classificationResult,
};
export const classificationStatus: ClassificationStatus = {
  schema_version: 1,
  active: false,
  poll_after_ms: 2000,
  items: [classifiedFile],
};
