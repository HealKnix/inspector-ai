export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const HASH = /^[0-9a-f]{64}$/;
export const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
export type Quality = "OK" | "LOW_QUALITY" | "ABSTAIN";
export type ArtifactValidationMode = "strict" | "stored";
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
}
export interface ParseArtifactData {
  schema_version: 1;
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
function reasons(value: unknown) {
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
  const imageKeys = new Set<string>();
  let blockCount = 0;
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
        // Earlier immutable DOCX artifacts used the same grid position for
        // several paragraph fragments. They remain readable, but must never
        // enter a new publication through a parser response or cache reuse.
        if (mode === "strict") {
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
    for (const cells of tables.values()) validateTableGrid(cells);
  }
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
