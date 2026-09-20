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

export function createRegionalParseResult(): ParseResult {
  const result = structuredClone(parseResult);
  const page = result.artifact.pages[0]!;
  result.artifact.region_schema_version = 1;
  result.artifact.versions.pdf_region_profile = "paddle-regions-v1";
  result.artifact.quality = page.quality = "OK";
  result.artifact.reasons = page.reasons = [];
  page.regions = [
    {
      id: "text-region",
      kind: "text",
      bbox: [0.05, 0.05, 0.4, 0.3],
      raw_class: "text",
      raw_score: 0.96,
      method: "native",
      reasons: [],
      table_status: "not_applicable",
    },
    {
      id: "graphic-region",
      kind: "graphic",
      bbox: [0.05, 0.35, 0.6, 0.9],
      raw_class: "image",
      raw_score: 0.75,
      method: "skipped",
      reasons: [],
      table_status: "not_applicable",
    },
    {
      id: "unknown-region",
      kind: "unknown",
      bbox: [0.65, 0.05, 0.95, 0.3],
      raw_class: null,
      raw_score: null,
      method: "skipped",
      reasons: ["LAYOUT_UNCERTAIN"],
      table_status: "not_applicable",
    },
    {
      id: "table-region",
      kind: "table",
      bbox: [0.65, 0.35, 0.95, 0.9],
      raw_class: "table",
      raw_score: 0.9,
      method: "native_table",
      reasons: [],
      table_status: "structured",
    },
  ];
  const base = page.blocks[0]!;
  page.blocks = [
    {
      ...base,
      source: "native",
      region_id: "text-region",
      include_in_main: true,
    },
    {
      ...base,
      id: "graphic-note",
      order: 1,
      raw_text: "Размер −250",
      normalized_text: "Размер −250",
      source: "native",
      bbox: [0.1, 0.4, 0.3, 0.45],
      region_id: "graphic-region",
      include_in_main: false,
    },
    {
      ...base,
      id: "unknown-note",
      order: 2,
      raw_text: "Неопределённая подпись",
      normalized_text: "Неопределённая подпись",
      source: "native",
      bbox: [0.7, 0.1, 0.9, 0.15],
      region_id: "unknown-region",
      include_in_main: false,
    },
    {
      ...base,
      id: "empty-cell",
      order: 3,
      raw_text: "",
      normalized_text: "",
      kind: "table_cell",
      source: "native",
      table_id: "table-1",
      row: 0,
      column: 0,
      row_span: 1,
      column_span: 1,
      bbox: [0.7, 0.4, 0.9, 0.45],
      region_id: "table-region",
      include_in_main: true,
    },
  ];
  result.artifact.raw_text = page.blocks
    .map((block) => block.raw_text)
    .join("\n");
  result.artifact.normalized_text = page.blocks
    .map((block) => block.normalized_text)
    .join("\n");
  return result;
}
