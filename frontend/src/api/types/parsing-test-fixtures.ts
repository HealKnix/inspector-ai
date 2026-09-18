import type { ParseResult, ParsingFile, ParsingStatus } from "./parsing";

// Synthetic documents for isolated client tests; no model-quality claim.
export const parsingObjectId = "11111111-1111-4111-8111-111111111111";
export const parsedFile: ParsingFile = {
  file_id: "22222222-2222-4222-8222-222222222222",
  process_id: "33333333-3333-4333-8333-333333333333",
  run_id: "44444444-4444-4444-8444-444444444444",
  original_name: "synthetic.xml",
  state: "succeeded",
  attempt: 1,
  pages_completed: 1,
  pages_total: 1,
  quality: "LOW_QUALITY",
  reasons: ["XML_SEMANTIC_RENDER"],
  error_code: null,
  can_retry: true,
  artifact_id: "55555555-5555-4555-8555-555555555555",
};
export const parsingStatus: ParsingStatus = {
  schema_version: 1,
  active: false,
  poll_after_ms: 2000,
  items: [parsedFile],
};
export const parseResult: ParseResult = {
  artifact_id: parsedFile.artifact_id!,
  file_id: parsedFile.file_id,
  run_id: parsedFile.run_id,
  artifact: {
    schema_version: 1,
    source_sha256: "a".repeat(64),
    pipeline_fingerprint: "c".repeat(64),
    versions: { renderer: "test" },
    raw_text: "Шифр  А-12",
    normalized_text: "Шифр А-12",
    quality: "LOW_QUALITY",
    reasons: ["XML_SEMANTIC_RENDER"],
    coverage: { total_pages: 1, readable_pages: 1, unreadable_pages: 0 },
    pages: [
      {
        page_number: 1,
        sheet_label: "Л-1",
        width: 800,
        height: 1000,
        image_key: "66666666-6666-4666-8666-666666666666",
        image_sha256: "b".repeat(64),
        quality: "LOW_QUALITY",
        reasons: ["XML_SEMANTIC_RENDER"],
        transform: { rotation: 90, render_width: 800, render_height: 1000 },
        blocks: [
          {
            id: "block-1",
            order: 0,
            kind: "text",
            raw_text: "Шифр  А-12",
            normalized_text: "Шифр А-12",
            bbox: [0.1, 0.2, 0.4, 0.25],
            confidence: null,
            source: "structured",
            structural_path: "/document/code",
            table_id: null,
            row: null,
            column: null,
            row_span: null,
            column_span: null,
          },
        ],
      },
    ],
  },
};
