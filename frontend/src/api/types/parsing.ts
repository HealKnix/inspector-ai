import { z } from "zod";

const qualitySchema = z.enum(["OK", "LOW_QUALITY", "ABSTAIN"]);
const count = z.number().int().nonnegative();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const coordinate = z.number().min(0).max(1);
const bboxSchema = z
  .tuple([coordinate, coordinate, coordinate, coordinate])
  .refine(
    ([x0, y0, x1, y1]) => x1 > x0 && y1 > y0,
    "Invalid visible-page rectangle",
  );
const provenanceReasons = z
  .array(z.string().regex(/^[a-z0-9_.:-]{1,128}$/i))
  .max(100);
const textProvenanceSchema = z
  .object({
    schema_version: z.literal(1),
    status: z.enum(["selected", "ambiguous"]),
    method: z.enum(["native", "ocr", "hybrid"]),
    fragments: z
      .array(
        z
          .object({
            source: z.enum(["native", "ocr"]),
            raw_text: z.string(),
            bbox: bboxSchema,
            native_valid: z.boolean().nullable(),
            role: z.enum(["selected", "alternative"]),
          })
          .strict()
          .refine(
            (fragment) =>
              fragment.source === "native"
                ? typeof fragment.native_valid === "boolean"
                : fragment.native_valid === null,
            "Invalid fragment native validation",
          ),
      )
      .min(1)
      .max(10_000),
    reasons: provenanceReasons,
  })
  .strict()
  .refine(
    (value) =>
      value.status === "ambiguous"
        ? value.reasons.length > 0
        : value.fragments.some((fragment) => fragment.role === "selected"),
    "Invalid provenance decision",
  )
  .refine((value) => {
    const sources = new Set(value.fragments.map((fragment) => fragment.source));
    return value.method === (sources.size > 1 ? "hybrid" : [...sources][0]);
  }, "Provenance method does not match its fragment sources");
const linkedIndices = z
  .array(count)
  .min(1)
  .max(10_000)
  .refine((items) => new Set(items).size === items.length);
const tableLinkSchema = z
  .object({
    schema_version: z.literal(1),
    status: z.enum(["associated", "ambiguous"]),
    table_id: z.string().min(1).max(256).nullable(),
    rows: linkedIndices,
    columns: linkedIndices,
    reasons: provenanceReasons,
  })
  .strict()
  .refine(
    (value) =>
      value.status === "associated"
        ? value.table_id !== null
        : value.reasons.length > 0,
    "Invalid table association",
  );

export const pageRegionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["text", "table", "graphic", "unknown"]),
  bbox: bboxSchema,
  raw_class: z.string().nullable(),
  raw_score: z.number().min(0).max(1).nullable(),
  method: z.enum([
    "native",
    "ocr",
    "hybrid",
    "native_table",
    "table_ocr",
    "skipped",
  ]),
  reasons: z.array(z.string()),
  table_status: z.enum([
    "not_applicable",
    "structured",
    "unconfirmed",
    "unreadable",
  ]),
});

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
    region_id: z.string().min(1).optional(),
    include_in_main: z.boolean().optional(),
    native_valid: z.boolean().optional(),
    provenance: textProvenanceSchema.optional(),
    table_link: tableLinkSchema.optional(),
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
  )
  .refine(
    (block) =>
      (block.native_valid === undefined || block.source === "native") &&
      ((block.native_valid !== false &&
        block.provenance?.status !== "ambiguous") ||
        block.include_in_main === false),
    "Unusable text must remain outside main content",
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
    regions: z.array(pageRegionSchema).optional(),
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
    region_schema_version: z.literal(1).optional(),
    text_provenance_schema_version: z.literal(1).optional(),
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
  )
  .superRefine((artifact, context) => {
    const regional = artifact.region_schema_version === 1;
    const regionProfile = ["paddle-regions-v1", "paddle-regions-v2"].includes(
      artifact.versions.pdf_region_profile ?? "",
    );
    const provenanceVersioned = artifact.text_provenance_schema_version === 1;
    if (
      provenanceVersioned !==
      (regional &&
        artifact.versions.text_provenance === "par-text-provenance-v1")
    )
      context.addIssue({
        code: "custom",
        message: "Inconsistent text provenance marker",
      });
    if (regional && !regionProfile) {
      context.addIssue({
        code: "custom",
        message: "Inconsistent PDF region profile",
      });
    }
    const regionIds = new Set<string>();
    for (const [index, page] of artifact.pages.entries()) {
      for (const [blockIndex, block] of page.blocks.entries()) {
        const path = ["pages", index, "blocks", blockIndex];
        if (
          provenanceVersioned &&
          block.raw_text.length > 0 &&
          !block.provenance
        )
          context.addIssue({
            code: "custom",
            path,
            message: "Nonempty PDF text requires provenance",
          });
        if (
          provenanceVersioned
            ? block.source === "native" && block.native_valid === undefined
            : block.native_valid !== undefined ||
              block.provenance !== undefined ||
              block.table_link !== undefined
        )
          context.addIssue({
            code: "custom",
            path,
            message: "Invalid versioned text metadata",
          });
        const link = block.table_link;
        if (link?.table_id) {
          const cells = page.blocks.filter(
            (cell) =>
              cell.kind === "table_cell" && cell.table_id === link.table_id,
          );
          if (
            !cells.length ||
            (link.status === "associated" &&
              !link.rows.every((row) =>
                link.columns.every((column) =>
                  cells.some(
                    (cell) =>
                      cell.row !== null &&
                      cell.column !== null &&
                      row >= cell.row &&
                      row < cell.row + (cell.row_span ?? 1) &&
                      column >= cell.column &&
                      column < cell.column + (cell.column_span ?? 1),
                  ),
                ),
              ))
          )
            context.addIssue({
              code: "custom",
              path,
              message: "Unresolved table association",
            });
        }
      }
      const pdfPage = page.transform.structural_mapping !== true;
      if ((regional && !pdfPage) || (pdfPage && regionProfile && !regional)) {
        context.addIssue({
          code: "custom",
          path: ["pages", index],
          message: "Inconsistent PDF region marker",
        });
      }
      if (!regional) {
        if (page.regions !== undefined)
          context.addIssue({
            code: "custom",
            path: ["pages", index, "regions"],
            message: "Page regions require a region schema version",
          });
        continue;
      }
      if (!page.regions) {
        context.addIssue({
          code: "custom",
          path: ["pages", index, "regions"],
          message: "Region profile requires page regions",
        });
        continue;
      }
      const regions = new Map(
        page.regions.map((region) => [region.id, region]),
      );
      for (const [regionIndex, region] of page.regions.entries()) {
        const methods = {
          text: ["native", "ocr", "hybrid"],
          table: ["native_table", "table_ocr", "hybrid"],
          graphic: ["skipped"],
          unknown: ["skipped"],
        };
        if (
          regionIds.has(region.id) ||
          !methods[region.kind].includes(region.method) ||
          (region.kind === "table"
            ? region.table_status === "not_applicable"
            : region.table_status !== "not_applicable")
        ) {
          context.addIssue({
            code: "custom",
            path: ["pages", index, "regions", regionIndex],
            message: "Inconsistent region type, method or id",
          });
        }
        regionIds.add(region.id);
      }
      for (const [blockIndex, block] of page.blocks.entries()) {
        const region = regions.get(block.region_id ?? "");
        if (
          !region ||
          typeof block.include_in_main !== "boolean" ||
          ((region.kind === "graphic" || region.kind === "unknown") &&
            (block.include_in_main || block.source !== "native")) ||
          (region &&
            ["native", "native_table"].includes(region.method) &&
            block.source === "ocr") ||
          (region &&
            ["ocr", "table_ocr"].includes(region.method) &&
            block.source === "native" &&
            block.include_in_main) ||
          (block.kind === "table_cell" &&
            (region?.kind !== "table" || region.table_status !== "structured"))
        ) {
          context.addIssue({
            code: "custom",
            path: ["pages", index, "blocks", blockIndex],
            message: "Invalid region membership",
          });
        }
      }
    }
  });

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
export type PageRegion = z.infer<typeof pageRegionSchema>;
