import type { RenderedPage, TextBlock } from "@/api/types/parsing";
import { isVisibleDocumentBlock } from "@/components/rendered-document-page/document-blocks";

export interface ExtractedTable {
  id: string;
  page: number;
  cells: TextBlock[];
}

export function groupTableCells(pages: RenderedPage[]): ExtractedTable[] {
  return pages.flatMap((page) => {
    const tables = new Map<string, ExtractedTable>();
    for (const block of [...page.blocks].sort((a, b) => a.order - b.order)) {
      if (block.kind !== "table_cell" || !isVisibleDocumentBlock(block))
        continue;
      const id = block.table_id ?? block.id;
      let table = tables.get(id);
      if (!table) {
        table = { id, page: page.page_number, cells: [] };
        tables.set(id, table);
      }
      table.cells.push(block);
    }
    return [...tables.values()];
  });
}

type GridSlot = { column: number; block: TextBlock | null };

// This is a display budget, not a parser limit. Larger/sparse tables retain
// every extracted cell in the list view without allocating their empty grid.
export function buildTableGrid(cells: TextBlock[]): GridSlot[][] | null {
  let rowCount = 0;
  let columnCount = 0;
  for (const cell of cells) {
    const { row, column, row_span: rowSpan, column_span: columnSpan } = cell;
    if (
      row === null ||
      column === null ||
      rowSpan === null ||
      columnSpan === null ||
      !Number.isSafeInteger(row) ||
      !Number.isSafeInteger(column) ||
      !Number.isSafeInteger(rowSpan) ||
      !Number.isSafeInteger(columnSpan) ||
      row < 0 ||
      column < 0 ||
      rowSpan < 1 ||
      columnSpan < 1 ||
      !Number.isSafeInteger(row + rowSpan) ||
      !Number.isSafeInteger(column + columnSpan)
    )
      return null;
    rowCount = Math.max(rowCount, row + rowSpan);
    columnCount = Math.max(columnCount, column + columnSpan);
  }
  if (!rowCount || columnCount > 100 || rowCount * columnCount > 2_000)
    return null;

  const grid: (TextBlock | null | undefined)[][] = Array.from(
    { length: rowCount },
    () => Array<TextBlock | null | undefined>(columnCount).fill(null),
  );
  for (const cell of cells) {
    const row = cell.row!;
    const column = cell.column!;
    for (let y = row; y < row + cell.row_span!; y++) {
      for (let x = column; x < column + cell.column_span!; x++) {
        if (grid[y]![x] !== null) return null;
        grid[y]![x] = y === row && x === column ? cell : undefined;
      }
    }
  }
  return grid.map((row) =>
    row.flatMap((block, column) =>
      block === undefined ? [] : [{ column, block }],
    ),
  );
}
