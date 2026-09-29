import { analysisBlocks } from "../parsing/analysis-blocks.js";
import type { ParseBlock } from "../parsing/parsing-contract.js";
import { blockText } from "./block-search.js";
import type { ResolvedSource, StreamBlock } from "./section-context.js";
import type { DiscoveredSection, SubmittedBlock } from "./section-contract.js";
import { SectionAnalysisError, utf8Bytes } from "./section-contract.js";

/** Grid id binding a block to a table, unless the link is ambiguous. */
function tableIdOf(item: StreamBlock): string | null {
  const link = item.block.table_link;
  if (link?.status === "ambiguous") return null;
  return item.block.table_id ?? link?.table_id ?? null;
}

/**
 * A serialized block ready for a provider request. text is the exact source
 * string the model may quote; table coordinates keep row/column/span metadata
 * and a label keeps the parser's verified row/column bindings so structure
 * survives serialization without faking a cell.
 */
export function serializeBlock(item: StreamBlock): SubmittedBlock {
  const { block, page } = item;
  const link =
    block.table_link?.status === "ambiguous" ? null : block.table_link;
  const table =
    block.kind === "table_cell" && block.table_id
      ? {
          table_id: block.table_id,
          kind: "cell" as const,
          row: block.row,
          column: block.column,
          row_span: block.row_span,
          column_span: block.column_span,
          rows: null,
          columns: null,
        }
      : link?.status === "associated" && link.table_id
        ? {
            table_id: link.table_id,
            kind: "label" as const,
            row: null,
            column: null,
            row_span: null,
            column_span: null,
            rows: link.rows.length ? [...link.rows] : null,
            columns: link.columns.length ? [...link.columns] : null,
          }
        : null;
  return {
    block_id: block.id,
    page_number: page.page_number,
    sheet_label: page.sheet_label,
    kind: block.kind,
    text: blockText(block),
    table,
  };
}

/**
 * The full inclusive boundary range of one section inside one source. Both
 * endpoint ids were validated against this source's stream beforehand; finding
 * them reversed or absent is a programming/contract violation, not content.
 */
export function materializeSection(
  source: ResolvedSource,
  section: DiscoveredSection,
): StreamBlock[] {
  const stream = source.stream;
  const start = stream.findIndex(
    (item) => item.block.id === section.start_block_id,
  );
  const end = stream.findIndex(
    (item) => item.block.id === section.end_block_id,
  );
  if (start < 0 || end < 0 || end < start)
    throw new SectionAnalysisError("section_materialize_invalid_bounds", false);
  return stream.slice(start, end + 1);
}

/**
 * Indivisible chunk units: every table grid forms one atomic span from its
 * first to its last member (cells plus associated labels), including the text
 * between them — the PAR contract does not require a table's members to be
 * consecutive, so consecutive grouping alone could silently split one grid.
 * Overlapping table spans merge; remaining blocks are singleton units.
 */
function units(stream: StreamBlock[]): StreamBlock[][] {
  // PAR guarantees table ids unique within a page only — identity is
  // (page_number, table_id) so same-named grids on different pages stay apart.
  const spans = new Map<string, { start: number; end: number }>();
  for (const [index, item] of stream.entries()) {
    const tableId = tableIdOf(item);
    if (!tableId) continue;
    const key = `${item.page.page_number}\n${tableId}`;
    const span = spans.get(key);
    if (span) span.end = index;
    else spans.set(key, { start: index, end: index });
  }
  const merged: { start: number; end: number }[] = [];
  for (const span of [...spans.values()].sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  const result: StreamBlock[][] = [];
  let cursor = 0;
  for (const span of merged) {
    while (cursor < span.start) result.push([stream[cursor++]!]);
    result.push(stream.slice(span.start, span.end + 1));
    cursor = span.end + 1;
  }
  while (cursor < stream.length) result.push([stream[cursor++]!]);
  return result;
}

export interface SectionChunk {
  /** 0-based part index inside this section. */
  index: number;
  blocks: SubmittedBlock[];
  stream: StreamBlock[];
  bytes: number;
}

export interface MaterializedSection {
  section: DiscoveredSection;
  source: ResolvedSource;
  chunks: SectionChunk[];
  /**
   * Block ids dropped for size/atomicity bounds — explicit missing coverage.
   * A whole table unit is dropped when any member is oversized: partial
   * grids are never submitted as if complete.
   */
  omitted_block_ids: string[];
  /**
   * Blocks the analysis eligibility filter removed inside the section's
   * block range (ambiguous/unresolved reads). Harmless exclusions — rejected
   * duplicates and invalid-native text with an accepted OCR replacement —
   * are not gaps.
   */
  filtered_block_ids: string[];
  /**
   * Selected pages between the section's endpoints with zero
   * analysis-eligible blocks — an unreadable middle page is a real gap even
   * though it produced no stream blocks at all.
   */
  unreadable_pages: number[];
  /**
   * Layout regions on touched pages whose content never became eligible
   * blocks — an unreadable/unconfirmed table or an unknown region that
   * produced nothing means content was present but is absent from the
   * submitted section. Listed as `page:region_id`; graphic regions and
   * skipped OCR passes over valid native text are deliberate exclusions,
   * not gaps.
   */
  unresolved_regions: string[];
}

/**
 * An excluded block is harmless only while its own ink is still represented
 * by an analysis-eligible block on the same page — real ambiguity is never
 * harmless, and identical text elsewhere does not prove retention. Safe
 * cases per pdf_fusion: (a) the exact source line (raw_text + bbox) is a
 * selected provenance fragment of an accepted block, e.g. a table cell
 * absorbing the native line; (b) an explicitly rejected duplicate reading
 * whose own provenance names the retained twin as an alternative fragment.
 */
function harmlessFiltered(block: ParseBlock, eligible: ParseBlock[]): boolean {
  if (block.provenance?.status === "ambiguous") return false;
  const bbox = block.bbox.join(",");
  const retainedAsFragment = eligible.some((other) =>
    (other.provenance?.fragments ?? []).some(
      (fragment) =>
        fragment.role === "selected" &&
        fragment.raw_text === block.raw_text &&
        fragment.bbox.join(",") === bbox,
    ),
  );
  if (retainedAsFragment) return true;
  // An invalid native line cannot be absorbed (fusion only assigns eligible
  // items), so without exact fragment retention it stays a real gap.
  if (block.native_valid === false) return false;
  const reasons = block.provenance?.reasons ?? [];
  if (
    reasons.length === 0 ||
    reasons.some(
      (reason) =>
        reason !== "DUPLICATE_NATIVE_READING" &&
        reason !== "DUPLICATE_OCR_READING",
    )
  )
    return false;
  // The hidden duplicate's provenance names the retained twin as a fragment
  // (role varies between fusion paths); identity is raw_text + bbox. The
  // twin may itself be hidden after absorption — then its ink survives as a
  // selected provenance fragment inside the accepted block, and the named
  // fragment must match exactly. Plain text equality is never linkage.
  return (block.provenance?.fragments ?? []).some((fragment) => {
    const key = fragment.bbox.join(",");
    return eligible.some(
      (other) =>
        other.id !== block.id &&
        ((other.raw_text === fragment.raw_text &&
          other.bbox.join(",") === key) ||
          (other.provenance?.fragments ?? []).some(
            (kept) =>
              kept.role === "selected" &&
              kept.raw_text === fragment.raw_text &&
              kept.bbox.join(",") === key,
          )),
    );
  });
}

/**
 * Table-aware chunking over the full inclusive range: units never split a
 * grid, oversized units are omitted and reported rather than truncated, so a
 * prefix is never mistaken for a full section.
 */
export function chunkSection(
  source: ResolvedSource,
  section: DiscoveredSection,
  maxChunkBytes: number,
  maxBlockCharacters: number,
): MaterializedSection {
  const stream = materializeSection(source, section);
  const omitted: string[] = [];
  const chunks: SectionChunk[] = [];
  let pending: StreamBlock[] = [];
  let pendingBlocks: SubmittedBlock[] = [];
  let pendingBytes = 0;
  const flush = () => {
    if (!pending.length) return;
    chunks.push({
      index: chunks.length,
      blocks: pendingBlocks,
      stream: pending,
      bytes: pendingBytes,
    });
    pending = [];
    pendingBlocks = [];
    pendingBytes = 0;
  };
  for (const unit of units(stream)) {
    const blocks: SubmittedBlock[] = [];
    const members: StreamBlock[] = [];
    let bytes = 0;
    let oversized = false;
    for (const item of unit) {
      const serialized = serializeBlock(item);
      if (serialized.text.length > maxBlockCharacters) {
        oversized = true;
        break;
      }
      members.push(item);
      blocks.push(serialized);
      bytes += utf8Bytes(serialized) + 1; // serialized text plus JSON comma
    }
    // A unit ships whole or not at all: an oversized member drops the entire
    // span (for tables, a partial grid would lie about completeness).
    if (oversized || bytes > maxChunkBytes) {
      for (const item of unit) omitted.push(item.block.id);
      continue;
    }
    if (pendingBytes + bytes > maxChunkBytes) flush();
    pending.push(...members);
    pendingBlocks.push(...blocks);
    pendingBytes += bytes;
  }
  flush();
  // Coverage over the physical page span between the endpoints: pages with
  // no analysis-eligible blocks at all, and excluded blocks strictly inside
  // the section's block order on the pages it touches.
  const filtered: string[] = [];
  const unreadable: number[] = [];
  const unresolvedRegions: string[] = [];
  if (stream.length) {
    const firstPage = stream[0]!.page.page_number;
    const lastPage = stream[stream.length - 1]!.page.page_number;
    for (const page of source.view.pages) {
      if (page.page_number < firstPage || page.page_number > lastPage) continue;
      const eligible = analysisBlocks(page);
      // A region the layout stage could not resolve is missing content even
      // when sibling text stayed readable: an unreadable/unconfirmed table
      // never yielded cells, and a table/unknown region with no eligible
      // blocks is unaccounted ink. Text regions stay out of this check —
      // their excluded blocks are judged per block by the filtered/harmless
      // scan, so a hidden duplicate must not double-report its region.
      // Graphics are excluded by design; a skipped region is harmless only
      // while its valid native reading is actually retained — an unknown
      // region with no eligible representation stays a gap either way.
      for (const region of page.regions ?? []) {
        if (region.kind === "graphic") continue;
        const served = eligible.some((block) => block.region_id === region.id);
        if (
          region.method === "skipped" &&
          (region.kind !== "unknown" || served)
        )
          continue;
        if (
          region.table_status === "unreadable" ||
          region.table_status === "unconfirmed" ||
          (region.kind !== "text" && !served)
        )
          unresolvedRegions.push(`${page.page_number}:${region.id}`);
      }
      if (!eligible.length) {
        unreadable.push(page.page_number);
        continue;
      }
      const eligibleIds = new Set(eligible.map((block) => block.id));
      // The section continues unbounded off its endpoint pages: on a
      // continuation page every block belongs to it, so only the first and
      // last stream blocks clamp the owned order range. Per-page eligible
      // bounds would miss ambiguous prefixes and tails on those pages.
      const lower =
        page.page_number === firstPage
          ? stream[0]!.block.order
          : Number.NEGATIVE_INFINITY;
      const upper =
        page.page_number === lastPage
          ? stream[stream.length - 1]!.block.order
          : Number.POSITIVE_INFINITY;
      for (const block of page.blocks)
        if (
          !eligibleIds.has(block.id) &&
          block.order >= lower &&
          block.order <= upper &&
          blockText(block) !== "" &&
          !harmlessFiltered(block, eligible)
        )
          filtered.push(block.id);
    }
  }
  return {
    section,
    source,
    chunks,
    omitted_block_ids: omitted,
    filtered_block_ids: filtered,
    unreadable_pages: unreadable,
    unresolved_regions: unresolvedRegions,
  };
}
