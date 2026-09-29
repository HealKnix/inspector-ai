export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const HASH = /^[0-9a-f]{64}$/;
export const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
export type Quality = "OK" | "LOW_QUALITY" | "ABSTAIN";
export type ArtifactValidationMode = "strict" | "stored";
export interface TextProvenance {
  schema_version: 1;
  status: "selected" | "ambiguous";
  method: "native" | "ocr" | "hybrid";
  fragments: {
    source: "native" | "ocr";
    raw_text: string;
    bbox: [number, number, number, number];
    native_valid: boolean | null;
    role: "selected" | "alternative";
  }[];
  reasons: string[];
}
export interface TableLink {
  schema_version: 1;
  status: "associated" | "ambiguous";
  table_id: string | null;
  rows: number[];
  columns: number[];
  reasons: string[];
}
export interface ParseRegion {
  id: string;
  kind: "text" | "table" | "graphic" | "unknown";
  bbox: [number, number, number, number];
  raw_class: string | null;
  raw_score: number | null;
  method:
    "native" | "ocr" | "hybrid" | "native_table" | "table_ocr" | "skipped";
  reasons: string[];
  table_status: "not_applicable" | "structured" | "unconfirmed" | "unreadable";
}
export interface ParseBlock {
  id: string;
  order: number;
  kind: "text" | "table_cell";
  raw_text: string;
  normalized_text: string;
  bbox: [number, number, number, number];
  confidence: number | null;
  source: "native" | "ocr" | "structured";
  structural_path: string | null;
  table_id: string | null;
  row: number | null;
  column: number | null;
  row_span: number | null;
  column_span: number | null;
  region_id?: string;
  include_in_main?: boolean;
  native_valid?: boolean;
  provenance?: TextProvenance;
  table_link?: TableLink;
}
export interface ParsePage {
  page_number: number;
  sheet_label: string | null;
  width: number;
  height: number;
  image_key: string;
  image_sha256: string;
  quality: Quality;
  reasons: string[];
  transform: Record<string, unknown>;
  blocks: ParseBlock[];
  regions?: ParseRegion[];
}
export interface ParseArtifactData {
  schema_version: 1;
  region_schema_version?: 1;
  text_provenance_schema_version?: 1;
  source_sha256: string;
  pipeline_fingerprint: string;
  versions: Record<string, string>;
  raw_text: string;
  normalized_text: string;
  quality: Quality;
  reasons: string[];
  coverage: {
    total_pages: number;
    readable_pages: number;
    unreadable_pages: number;
  };
  pages: ParsePage[];
}
export class ParsingError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly admitted = false,
  ) {
    super(code);
  }
}
function check(condition: unknown): asserts condition {
  if (!condition) throw new ParsingError("parser_invalid_result", false);
}
export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function integer(value: unknown, min = 0): value is number {
  return finite(value) && Number.isSafeInteger(value) && value >= min;
}
function quality(value: unknown): value is Quality {
  return value === "OK" || value === "LOW_QUALITY" || value === "ABSTAIN";
}
function reasons(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every(
      (item: unknown) =>
        typeof item === "string" && /^[a-z0-9_.:-]{1,128}$/i.test(item),
    )
  );
}
function text(value: unknown) {
  return typeof value === "string" && value.length <= MAX_ARTIFACT_BYTES;
}
function box(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((v: unknown) => finite(v) && v >= 0 && v <= 1) &&
    value[0] < value[2] &&
    value[1] < value[3]
  );
}
function vector(value: unknown, size: number): value is number[] {
  return Array.isArray(value) && value.length === size && value.every(finite);
}

function validateTextMetadata(
  block: Record<string, unknown>,
  versioned: boolean,
) {
  if (!versioned) {
    check(
      block.native_valid === undefined &&
        block.provenance === undefined &&
        block.table_link === undefined,
    );
    return;
  }
  check(
    block.source === "native"
      ? typeof block.native_valid === "boolean"
      : block.native_valid === undefined,
  );
  if (block.native_valid === false) check(block.include_in_main === false);
  if (typeof block.raw_text === "string" && block.raw_text.length > 0)
    check(block.provenance !== undefined);
  if (block.provenance !== undefined) {
    const value = block.provenance;
    check(
      record(value) &&
        Object.keys(value).every((key) =>
          [
            "schema_version",
            "status",
            "method",
            "fragments",
            "reasons",
          ].includes(key),
        ),
    );
    check(
      value.schema_version === 1 &&
        ["selected", "ambiguous"].includes(String(value.status)) &&
        ["native", "ocr", "hybrid"].includes(String(value.method)) &&
        reasons(value.reasons),
    );
    check(
      Array.isArray(value.fragments) &&
        value.fragments.length > 0 &&
        value.fragments.length <= 10_000,
    );
    for (const fragment of value.fragments) {
      check(
        record(fragment) &&
          Object.keys(fragment).every((key) =>
            ["source", "raw_text", "bbox", "native_valid", "role"].includes(
              key,
            ),
          ),
      );
      check(
        ["native", "ocr"].includes(String(fragment.source)) &&
          text(fragment.raw_text) &&
          box(fragment.bbox) &&
          ["selected", "alternative"].includes(String(fragment.role)),
      );
      check(
        fragment.source === "native"
          ? typeof fragment.native_valid === "boolean"
          : fragment.native_valid === null,
      );
    }
    const sources = new Set(
      value.fragments.map(
        (fragment: Record<string, unknown>) => fragment.source,
      ),
    );
    check(value.method === (sources.size > 1 ? "hybrid" : [...sources][0]));
    if (value.status === "ambiguous")
      check(block.include_in_main === false && value.reasons.length > 0);
    else
      check(
        value.fragments.some(
          (fragment: Record<string, unknown>) => fragment.role === "selected",
        ),
      );
  }
  if (block.table_link !== undefined) {
    const link = block.table_link;
    check(
      record(link) &&
        Object.keys(link).every((key) =>
          [
            "schema_version",
            "status",
            "table_id",
            "rows",
            "columns",
            "reasons",
          ].includes(key),
        ),
    );
    check(
      link.schema_version === 1 &&
        ["associated", "ambiguous"].includes(String(link.status)) &&
        reasons(link.reasons),
    );
    check(
      (typeof link.table_id === "string" &&
        link.table_id.length > 0 &&
        link.table_id.length <= 256) ||
        (link.status === "ambiguous" && link.table_id === null),
    );
    for (const indices of [link.rows, link.columns])
      check(
        Array.isArray(indices) &&
          indices.length > 0 &&
          indices.length <= 10_000 &&
          indices.every((item) => integer(item)) &&
          new Set(indices).size === indices.length,
      );
    if (link.status === "ambiguous") check(link.reasons.length > 0);
  }
}

function validateRegion(value: unknown): ParseRegion {
  check(record(value));
  const fields = new Set([
    "id",
    "kind",
    "bbox",
    "raw_class",
    "raw_score",
    "method",
    "reasons",
    "table_status",
  ]);
  check(Object.keys(value).every((key) => fields.has(key)));
  check(
    typeof value.id === "string" &&
      value.id.length > 0 &&
      value.id.length <= 256,
  );
  check(box(value.bbox) && reasons(value.reasons));
  check(
    value.raw_class === null ||
      (typeof value.raw_class === "string" &&
        value.raw_class.length > 0 &&
        value.raw_class.length <= 128),
  );
  check(
    value.raw_score === null ||
      (finite(value.raw_score) && value.raw_score >= 0 && value.raw_score <= 1),
  );
  if (value.kind === "graphic" || value.kind === "unknown") {
    check(
      value.method === "skipped" &&
        value.table_status === "not_applicable" &&
        value.reasons.length > 0,
    );
  } else if (value.kind === "text") {
    check(
      ["native", "ocr", "hybrid"].includes(String(value.method)) &&
        value.table_status === "not_applicable",
    );
  } else {
    check(value.kind === "table");
    check(
      ["native_table", "table_ocr", "hybrid"].includes(String(value.method)),
    );
    check(
      ["structured", "unconfirmed", "unreadable"].includes(
        String(value.table_status),
      ),
    );
    check(value.table_status === "structured" || value.reasons.length > 0);
  }
  return value as unknown as ParseRegion;
}

function validateRegionBlock(
  block: Record<string, unknown>,
  regions: Map<string, ParseRegion>,
) {
  check(
    typeof block.region_id === "string" &&
      typeof block.include_in_main === "boolean",
  );
  const region = regions.get(block.region_id);
  check(region);
  // Region boundaries need not contain whole glyphs; intersecting native runs
  // retain their original geometry rather than being clipped to the layout box.
  check(block.source === "native" || block.source === "ocr");
  if (region.method === "skipped") {
    check(
      block.source === "native" &&
        block.include_in_main === false &&
        block.kind === "text",
    );
  } else if (region.method === "native" || region.method === "native_table") {
    check(block.source === "native");
  } else if (region.method === "ocr" || region.method === "table_ocr") {
    // Invalid native Unicode is retained for audit alongside replacement OCR.
    check(block.source !== "native" || block.include_in_main === false);
  }
  if (block.kind === "table_cell") {
    check(region.kind === "table" && region.table_status === "structured");
  }
  if (block.source === "ocr" && block.kind === "text") {
    check(
      typeof block.raw_text === "string" && block.raw_text.trim().length > 0,
    );
    check(
      typeof block.normalized_text === "string" &&
        block.normalized_text.trim().length > 0,
    );
  }
}

interface GridCell {
  row: number;
  rowEnd: number;
  column: number;
  columnEnd: number;
}

function validateTableGrid(cells: GridCell[]) {
  if (cells.length < 2) return;
  const columns = [
    ...new Set(cells.flatMap((cell) => [cell.column, cell.columnEnd])),
  ].sort((left, right) => left - right);
  const indices = new Map(columns.map((column, index) => [column, index]));
  const starts = new Int32Array(columns.length + 1);
  const ends = new Int32Array(columns.length + 1);
  const add = (tree: Int32Array, index: number, delta: number) => {
    for (
      let cursor = index + 1;
      cursor < tree.length;
      cursor += cursor & -cursor
    )
      tree[cursor] = tree[cursor]! + delta;
  };
  const before = (tree: Int32Array, index: number) => {
    let count = 0;
    for (let cursor = index; cursor > 0; cursor -= cursor & -cursor)
      count += tree[cursor]!;
    return count;
  };
  const events = cells.flatMap((cell) => [
    { row: cell.row, delta: 1, cell },
    { row: cell.rowEnd, delta: -1, cell },
  ]);
  // Half-open logical rectangles may touch. Remove ending cells first, then
  // count active column intervals in O(log n), without expanding large spans.
  events.sort(
    (left, right) => left.row - right.row || left.delta - right.delta,
  );
  for (const { delta, cell } of events) {
    const start = indices.get(cell.column)!;
    const end = indices.get(cell.columnEnd)!;
    if (delta === 1) check(before(starts, end) === before(ends, start + 1));
    add(starts, start, delta);
    add(ends, end, delta);
  }
}

// The parser is an untrusted boundary. An image handle never becomes a path and
// a result cannot supply its own domain object, run or task identity.
export function validateArtifact(
  value: unknown,
  sourceHash: string,
  fingerprint: string,
  mode: ArtifactValidationMode = "strict",
): ParseArtifactData {
  check(record(value));
  const allowed = new Set([
    "schema_version",
    "region_schema_version",
    "text_provenance_schema_version",
    "source_sha256",
    "pipeline_fingerprint",
    "versions",
    "raw_text",
    "normalized_text",
    "quality",
    "reasons",
    "coverage",
    "pages",
  ]);
  check(Object.keys(value).every((key) => allowed.has(key)));
  check(
    value.schema_version === 1 &&
      HASH.test(sourceHash) &&
      HASH.test(fingerprint),
  );
  check(
    value.region_schema_version === undefined ||
      value.region_schema_version === 1,
  );
  const regional = value.region_schema_version === 1;
  check(
    value.text_provenance_schema_version === undefined ||
      value.text_provenance_schema_version === 1,
  );
  const provenanceVersioned = value.text_provenance_schema_version === 1;
  check(
    value.source_sha256 === sourceHash &&
      value.pipeline_fingerprint === fingerprint,
  );
  check(
    record(value.versions) &&
      Object.keys(value.versions).length > 0 &&
      Object.keys(value.versions).length <= 64,
  );
  check(
    Object.entries(value.versions).every(
      ([key, version]) =>
        /^[a-z0-9_.-]{1,64}$/i.test(key) &&
        typeof version === "string" &&
        version.length > 0 &&
        version.length <= 256,
    ),
  );
  check(
    provenanceVersioned ===
      (regional && value.versions.text_provenance === "par-text-provenance-v1"),
  );
  check(
    text(value.raw_text) &&
      text(value.normalized_text) &&
      quality(value.quality) &&
      reasons(value.reasons),
  );
  check(
    Array.isArray(value.pages) &&
      value.pages.length > 0 &&
      value.pages.length <= 10_000,
  );
  check(record(value.coverage));
  check(
    value.coverage.total_pages === value.pages.length &&
      integer(value.coverage.readable_pages) &&
      integer(value.coverage.unreadable_pages),
  );
  check(
    value.coverage.readable_pages + value.coverage.unreadable_pages ===
      value.pages.length,
  );
  const ids = new Set<string>();
  const regionIds = new Set<string>();
  const imageKeys = new Set<string>();
  let blockCount = 0;
  let readablePages = 0;
  for (const [index, page] of value.pages.entries()) {
    check(record(page) && page.page_number === index + 1);
    check(
      page.sheet_label === null ||
        (typeof page.sheet_label === "string" &&
          page.sheet_label.length <= 1000),
    );
    check(
      finite(page.width) &&
        page.width > 0 &&
        page.width <= 100_000 &&
        finite(page.height) &&
        page.height > 0 &&
        page.height <= 100_000,
    );
    check(
      typeof page.image_key === "string" &&
        UUID.test(page.image_key) &&
        !imageKeys.has(page.image_key),
    );
    imageKeys.add(page.image_key);
    check(
      typeof page.image_sha256 === "string" &&
        HASH.test(page.image_sha256) &&
        quality(page.quality) &&
        reasons(page.reasons),
    );
    check(
      record(page.transform) &&
        page.transform.coordinate_space === "visible-page-normalized",
    );
    const transform = page.transform;
    const pdfPage = transform.structural_mapping !== true;
    if (regional)
      check(
        pdfPage &&
          ["paddle-regions-v1", "paddle-regions-v2"].includes(
            String(value.versions.pdf_region_profile),
          ),
      );
    if (
      pdfPage &&
      ["paddle-regions-v1", "paddle-regions-v2"].includes(
        String(value.versions.pdf_region_profile),
      )
    )
      check(regional);
    const pageRegions = new Map<string, ParseRegion>();
    if (regional) {
      check(Array.isArray(page.regions) && page.regions.length <= 10_000);
      for (const item of page.regions) {
        const region = validateRegion(item);
        check(!regionIds.has(region.id));
        regionIds.add(region.id);
        check(regionIds.size <= 100_000);
        pageRegions.set(region.id, region);
      }
    } else check(page.regions === undefined);
    check(
      typeof transform.renderer === "string" &&
        transform.renderer.length > 0 &&
        transform.renderer.length <= 256,
    );
    check(
      integer(transform.render_width, 1) &&
        integer(transform.render_height, 1) &&
        transform.render_width <= 100_000 &&
        transform.render_height <= 100_000,
    );
    check(
      page.width === transform.render_width &&
        page.height === transform.render_height,
    );
    if (transform.structural_mapping === true) {
      check(
        typeof transform.font_sha256 === "string" &&
          HASH.test(transform.font_sha256),
      );
      check(
        typeof transform.layout === "string" && transform.layout.length > 0,
      );
    } else {
      check(vector(transform.media_box, 4) && vector(transform.crop_box, 4));
      check(
        transform.media_box[0]! < transform.media_box[2]! &&
          transform.media_box[1]! < transform.media_box[3]!,
      );
      check(
        transform.crop_box[0]! < transform.crop_box[2]! &&
          transform.crop_box[1]! < transform.crop_box[3]!,
      );
      check([0, 90, 180, 270].includes(Number(transform.rotation)));
      check(
        vector(transform.pdf_to_visible, 6) &&
          vector(transform.visible_to_pdf, 6),
      );
      const [a, b, c, d, e, f] = transform.pdf_to_visible as [
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      const [g, h, i, j, k, l] = transform.visible_to_pdf as [
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      const close = (left: number, right: number) =>
        Math.abs(left - right) < 1e-4;
      check(
        close(g * a + i * b, 1) &&
          close(h * a + j * b, 0) &&
          close(g * c + i * d, 0) &&
          close(h * c + j * d, 1) &&
          close(g * e + i * f + k, 0) &&
          close(h * e + j * f + l, 0),
      );
    }
    check(Array.isArray(page.blocks));
    blockCount += page.blocks.length;
    check(blockCount <= 1_000_000);
    let previousOrder = -1;
    const tables = new Map<string, GridCell[]>();
    const regionTableCells = new Set<string>();
    const tableRegions = new Map<string, string>();
    for (const block of page.blocks) {
      check(
        record(block) &&
          typeof block.id === "string" &&
          block.id.length > 0 &&
          block.id.length <= 256 &&
          !ids.has(block.id),
      );
      ids.add(block.id);
      check(integer(block.order) && block.order > previousOrder);
      previousOrder = block.order;
      check(block.kind === "text" || block.kind === "table_cell");
      check(
        text(block.raw_text) && text(block.normalized_text) && box(block.bbox),
      );
      check(
        block.confidence === null ||
          (finite(block.confidence) &&
            block.confidence >= 0 &&
            block.confidence <= 1),
      );
      check(
        block.source === "native" ||
          block.source === "ocr" ||
          block.source === "structured",
      );
      validateTextMetadata(block, provenanceVersioned);
      if (regional) {
        validateRegionBlock(block, pageRegions);
        if (block.kind === "table_cell")
          regionTableCells.add(block.region_id as string);
      } else
        check(
          block.region_id === undefined && block.include_in_main === undefined,
        );
      check(
        block.structural_path === null ||
          (typeof block.structural_path === "string" &&
            block.structural_path.length > 0 &&
            block.structural_path.length <= 16_384),
      );
      check(
        block.source !== "structured" ||
          (transform.structural_mapping === true &&
            typeof block.structural_path === "string"),
      );
      check(
        block.table_id === null ||
          (typeof block.table_id === "string" &&
            block.table_id.length > 0 &&
            block.table_id.length <= 256),
      );
      for (const key of ["row", "column", "row_span", "column_span"] as const)
        check(
          block[key] === null ||
            integer(block[key], key.endsWith("span") ? 1 : 0),
        );
      if (block.kind === "table_cell") {
        check(
          typeof block.table_id === "string" &&
            integer(block.row) &&
            integer(block.column) &&
            integer(block.row_span, 1) &&
            integer(block.column_span, 1),
        );
        if (regional) {
          const regionId = block.region_id as string;
          check(
            !tableRegions.has(block.table_id) ||
              tableRegions.get(block.table_id) === regionId,
          );
          tableRegions.set(block.table_id, regionId);
        }
        // Earlier immutable DOCX artifacts used the same grid position for
        // several paragraph fragments. They remain readable, but must never
        // enter a new publication through a parser response or cache reuse.
        if (mode === "strict" || regional) {
          const rowEnd = block.row + block.row_span;
          const columnEnd = block.column + block.column_span;
          check(integer(rowEnd, 1) && integer(columnEnd, 1));
          const cells = tables.get(block.table_id) ?? [];
          cells.push({
            row: block.row,
            rowEnd,
            column: block.column,
            columnEnd,
          });
          tables.set(block.table_id, cells);
        }
      }
    }
    for (const block of page.blocks as ParseBlock[]) {
      const link = block.table_link;
      if (!link || link.table_id === null) continue;
      const cells = tables.get(link.table_id);
      check(cells);
      if (link.status === "associated") {
        // A link names actual cells, including their spans; a nearby label is
        // never silently attached to a made-up row or a different page.
        check(
          link.rows.every((row) =>
            link.columns.every((column) =>
              cells.some(
                (cell) =>
                  row >= cell.row &&
                  row < cell.rowEnd &&
                  column >= cell.column &&
                  column < cell.columnEnd,
              ),
            ),
          ),
        );
      }
    }
    for (const region of pageRegions.values()) {
      if (region.table_status === "structured")
        check(regionTableCells.has(region.id));
    }
    if (
      page.blocks.some(
        (block: Record<string, unknown>) =>
          typeof block.normalized_text === "string" &&
          block.normalized_text.length > 0,
      )
    )
      readablePages++;
    for (const cells of tables.values()) validateTableGrid(cells);
  }
  // Coverage describes extracted text, not whether planned graphic skipping is
  // an error. A regional graphic-only page may be OK with zero readable pages.
  if (regional) check(value.coverage.readable_pages === readablePages);
  return value as unknown as ParseArtifactData;
}

export interface ParsingMessage {
  schema_version: 1;
  task_id: string;
  run_id: string;
  process_id: string;
  object_id: string;
  file_id: string;
  cycle: number;
}
export function validateMessage(value: unknown): ParsingMessage {
  check(record(value) && value.schema_version === 1);
  for (const key of ["task_id", "run_id", "process_id", "object_id", "file_id"])
    check(typeof value[key] === "string" && UUID.test(value[key]));
  check(integer(value.cycle, 1));
  return value as unknown as ParsingMessage;
}
