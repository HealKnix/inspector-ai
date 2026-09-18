import { z } from "zod";

const qualitySchema = z.enum(["OK", "LOW_QUALITY", "ABSTAIN"]);
const count = z.number().int().nonnegative();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const coordinate = z.number().min(0).max(1);

export const parsingFileSchema = z.object({
  file_id: z.uuid(),
  process_id: z.uuid(),
  run_id: z.uuid(),
  original_name: z.string(),
  state: z.enum(["queued", "processing", "succeeded", "failed"]),
  attempt: count,
  pages_completed: count,
  pages_total: count.nullable(),
  quality: qualitySchema.nullable(),
  reasons: z.array(z.string()),
  error_code: z.string().nullable(),
  can_retry: z.boolean(),
  artifact_id: z.uuid().nullable(),
  phase: z.string().nullable().optional(),
  progress_updated_at: z.iso.datetime({ offset: true }).nullable().optional(),
  waiting_reason: z
    .enum(["models_not_ready", "parser_busy", "retry_backoff"])
    .nullable()
    .optional(),
  retry_at: z.iso.datetime({ offset: true }).nullable().optional(),
  checkpoint_pages: count.nullable().optional(),
  checkpoint_validated: z.boolean().nullable().optional(),
  current_page: z.number().int().positive().nullable().optional(),
  previous_attempt_error: z.string().nullable().optional(),
  progress_reset_reason: z
    .enum(["pipeline_version_changed", "saved_pages_unavailable"])
    .nullable()
    .optional(),
});

export const parsingStatusSchema = z.object({
  schema_version: z.literal(1),
  active: z.boolean(),
  poll_after_ms: z.number().int().positive(),
  items: z.array(parsingFileSchema),
});

export const textBlockSchema = z
  .object({
    id: z.string(),
    order: count,
    kind: z.enum(["text", "table_cell"]),
    raw_text: z.string(),
    normalized_text: z.string(),
    bbox: z
      .tuple([coordinate, coordinate, coordinate, coordinate])
      .refine(
        ([x0, y0, x1, y1]) => x1 > x0 && y1 > y0,
        "Invalid visible-page rectangle",
      ),
    confidence: z.number().min(0).max(1).nullable(),
    source: z.enum(["native", "ocr", "structured"]),
    structural_path: z.string().nullable(),
    table_id: z.string().nullable(),
    row: count.nullable(),
    column: count.nullable(),
    row_span: z.number().int().positive().nullable(),
    column_span: z.number().int().positive().nullable(),
  })
  .refine(
    (block) =>
      block.kind !== "table_cell" ||
      (Boolean(block.table_id) &&
        block.row !== null &&
        block.column !== null &&
        block.row_span !== null &&
        block.column_span !== null &&
        Number.isSafeInteger(block.row + block.row_span) &&
        Number.isSafeInteger(block.column + block.column_span)),
    "Incomplete or unsafe table coordinates",
  );

export const renderedPageSchema = z
  .object({
    page_number: z.number().int().positive(),
    sheet_label: z.string().nullable(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    image_key: z.uuid(),
    image_sha256: hash,
    quality: qualitySchema,
    reasons: z.array(z.string()),
    transform: z.record(z.string(), z.unknown()),
    blocks: z.array(textBlockSchema),
  })
  .refine(
    (page) =>
      page.width === page.transform.render_width &&
      page.height === page.transform.render_height,
    "Page dimensions do not match the rendered image",
  );

export const parseArtifactSchema = z
  .object({
    schema_version: z.literal(1),
    source_sha256: hash,
    pipeline_fingerprint: hash,
    versions: z.record(z.string(), z.string()),
    raw_text: z.string(),
    normalized_text: z.string(),
    quality: qualitySchema,
    reasons: z.array(z.string()),
    coverage: z.object({
      total_pages: count,
      readable_pages: count,
      unreadable_pages: count,
    }),
    pages: z.array(renderedPageSchema),
  })
  .refine(
    ({ pages, coverage }) =>
      pages.length === coverage.total_pages &&
      coverage.readable_pages + coverage.unreadable_pages ===
        coverage.total_pages &&
      pages.every((page, index) => page.page_number === index + 1),
    "Invalid page coverage",
  );

export const parseResultSchema = z.object({
  artifact_id: z.uuid(),
  file_id: z.uuid(),
  run_id: z.uuid(),
  artifact: parseArtifactSchema,
});

export type ParsingFile = z.infer<typeof parsingFileSchema>;
export type ParsingStatus = z.infer<typeof parsingStatusSchema>;
export type ParseResult = z.infer<typeof parseResultSchema>;
export type RenderedPage = z.infer<typeof renderedPageSchema>;
export type TextBlock = z.infer<typeof textBlockSchema>;
