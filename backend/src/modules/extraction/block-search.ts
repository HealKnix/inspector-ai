import type {
  ParseArtifactData,
  ParseBlock,
  ParsePage,
} from "../parsing/parsing-contract.js";
import type { EvidenceLocator, TableSignature } from "./extraction-contract.js";

/** Case/ё/spacing-insensitive term matching over normalized block text. */
export function normalizeTerm(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

export function blockText(block: ParseBlock): string {
  return (block.normalized_text || block.raw_text).trim();
}

export function blockMatches(block: ParseBlock, term: string): boolean {
  const haystack = normalizeTerm(blockText(block));
  return haystack.length > 0 && haystack.includes(normalizeTerm(term));
}

export interface AnchorHit {
  page: ParsePage;
  block: ParseBlock;
  term: string;
}

export function findAnchorHits(
  artifact: ParseArtifactData,
  terms: string[],
): AnchorHit[] {
  const hits: AnchorHit[] = [];
  for (const page of artifact.pages) {
    for (const block of page.blocks) {
      if (block.include_in_main === false) continue;
      const text = blockText(block);
      if (!text) continue;
      for (const term of terms) {
        if (blockMatches(block, term)) {
          hits.push({ page, block, term });
          break;
        }
      }
    }
  }
  return hits;
}

export interface TableGrid {
  tableId: string;
  page: ParsePage;
  tableStatus:
    "not_applicable" | "structured" | "unconfirmed" | "unreadable" | null;
  cells: ParseBlock[];
  rows: Map<number, ParseBlock[]>;
  /** Concatenated normalized text of all cells, for signature matching. */
  text: string;
  top: number;
}

export function pageTables(page: ParsePage): TableGrid[] {
  const byTable = new Map<string, ParseBlock[]>();
  for (const block of page.blocks) {
    if (block.kind !== "table_cell" || !block.table_id) continue;
    const cells = byTable.get(block.table_id) ?? [];
    cells.push(block);
    byTable.set(block.table_id, cells);
  }
  const regions = new Map(
    (page.regions ?? []).map((region) => [region.id, region] as const),
  );
  const grids: TableGrid[] = [];
  for (const [tableId, cells] of byTable) {
    const rows = new Map<number, ParseBlock[]>();
    for (const cell of cells) {
      const row = cell.row ?? 0;
      const list = rows.get(row) ?? [];
      list.push(cell);
      rows.set(row, list);
    }
    for (const list of rows.values())
      list.sort((a, b) => (a.column ?? 0) - (b.column ?? 0));
    const sample = cells[0]!;
    const region = sample.region_id ? regions.get(sample.region_id) : null;
    grids.push({
      tableId,
      page,
      tableStatus: region?.kind === "table" ? region.table_status : null,
      cells,
      rows,
      text: cells.map((cell) => normalizeTerm(blockText(cell))).join(" "),
      top: Math.min(...cells.map((cell) => cell.bbox[1])),
    });
  }
  return grids;
}

/** Text blocks just above the table top on the same page — caption candidates. */
function captionText(grid: TableGrid): string {
  const captions = grid.page.blocks
    .filter(
      (block) =>
        block.kind === "text" &&
        blockText(block).length > 0 &&
        block.bbox[3] <= grid.top + 0.01 &&
        grid.top - block.bbox[3] <= 0.12,
    )
    .sort((a, b) => b.bbox[3] - a.bbox[3])
    .slice(0, 3);
  return normalizeTerm(captions.map((block) => blockText(block)).join(" "));
}

export interface TableCandidate {
  grid: TableGrid;
  score: number;
  matched: string[];
}

export function tableCandidates(
  artifact: ParseArtifactData,
  signature: TableSignature,
): TableCandidate[] {
  const candidates: TableCandidate[] = [];
  for (const page of artifact.pages) {
    for (const grid of pageTables(page)) {
      const haystack = `${grid.text} ${captionText(grid)}`;
      const allOk = (signature.all ?? []).every((term) =>
        haystack.includes(normalizeTerm(term)),
      );
      if (!allOk) continue;
      const matched = signature.any.filter((term) =>
        haystack.includes(normalizeTerm(term)),
      );
      const captionHits = (signature.caption ?? []).filter((term) =>
        captionText(grid).includes(normalizeTerm(term)),
      );
      const score = matched.length + 2 * captionHits.length;
      if (score < (signature.min_score ?? 1)) continue;
      candidates.push({ grid, score, matched });
    }
  }
  candidates.sort(
    (a, b) =>
      b.score - a.score || a.grid.page.page_number - b.grid.page.page_number,
  );
  return candidates;
}

export function locatorFor(
  block: ParseBlock | null,
  page: ParsePage,
  quote?: string,
): EvidenceLocator {
  return {
    page_number: page.page_number,
    sheet_label: page.sheet_label,
    block_id: block?.id ?? null,
    table_id: block?.table_id ?? null,
    table_row: block?.row ?? null,
    table_column: block?.column ?? null,
    quote: (quote ?? (block ? blockText(block) : "")).slice(0, 900),
    bbox: block ? [...block.bbox] : null,
    structural_path: block?.structural_path ?? null,
  };
}

export interface ContextWindow {
  page_number: number;
  sheet_label: string | null;
  table_id: string | null;
  /** Serialized table rows: "r3: ячейка | ячейка". */
  lines: { block_id: string | null; text: string }[];
}

const MAX_WINDOWS = 16;
const MAX_WINDOW_LINES = 60;
const MAX_LINE_CHARACTERS = 600;

/**
 * Compact evidence windows around anchor hits for drafting/dry-run: the hit
 * block with neighbours, and the whole containing table serialized as rows.
 */
export function contextWindows(
  artifact: ParseArtifactData,
  terms: string[],
): ContextWindow[] {
  const hits = findAnchorHits(artifact, terms);
  const windows: ContextWindow[] = [];
  const seenPages = new Set<string>();
  for (const hit of hits) {
    const key = hit.block.table_id
      ? `${hit.page.page_number}:${hit.block.table_id}`
      : `${hit.page.page_number}:${Math.round(hit.block.bbox[1] * 10)}`;
    if (seenPages.has(key) || windows.length >= MAX_WINDOWS) continue;
    seenPages.add(key);
    if (hit.block.table_id) {
      const grid = pageTables(hit.page).find(
        (table) => table.tableId === hit.block.table_id,
      );
      if (!grid) continue;
      const lines: ContextWindow["lines"] = [];
      for (const [row, cells] of [...grid.rows.entries()].sort(
        (a, b) => a[0] - b[0],
      )) {
        if (lines.length >= MAX_WINDOW_LINES) break;
        lines.push({
          block_id: cells[0]?.id ?? null,
          text: `r${row}: ${cells
            .map((cell) => blockText(cell).slice(0, MAX_LINE_CHARACTERS))
            .join(" | ")}`,
        });
      }
      windows.push({
        page_number: hit.page.page_number,
        sheet_label: hit.page.sheet_label,
        table_id: grid.tableId,
        lines,
      });
    } else {
      const index = hit.page.blocks.indexOf(hit.block);
      const lines = hit.page.blocks
        .slice(Math.max(0, index - 3), index + 4)
        .filter((block) => blockText(block).length > 0)
        .map((block) => ({
          block_id: block.id,
          text: blockText(block).slice(0, MAX_LINE_CHARACTERS),
        }));
      windows.push({
        page_number: hit.page.page_number,
        sheet_label: hit.page.sheet_label,
        table_id: null,
        lines,
      });
    }
  }
  return windows;
}
