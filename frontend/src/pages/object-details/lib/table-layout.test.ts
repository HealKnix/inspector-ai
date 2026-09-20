import { textBlockSchema, type TextBlock } from "@/api/types/parsing";
import { parseResult } from "@/api/types/parsing-test-fixtures";
import { buildTableGrid, groupTableCells } from "./table-layout";

const page = parseResult.artifact.pages[0]!;
function cell(
  id: string,
  row: number,
  column: number,
  rowSpan = 1,
  columnSpan = 1,
): TextBlock {
  return {
    ...page.blocks[0]!,
    id,
    kind: "table_cell",
    table_id: "synthetic-table",
    row,
    column,
    row_span: rowSpan,
    column_span: columnSpan,
  };
}

describe("table display geometry", () => {
  it("preserves merged cells and uncovered slots without inventing cell text", () => {
    const merged = cell("merged", 0, 0, 2, 2);
    const right = cell("right", 1, 2);
    expect(buildTableGrid([merged, right])).toEqual([
      [
        { column: 0, block: merged },
        { column: 2, block: null },
      ],
      [{ column: 2, block: right }],
    ]);
  });
  it("falls back for overlapping legacy cells, unsafe sums, and very sparse grids", () => {
    expect(
      buildTableGrid([cell("one", 0, 0, 2), cell("two", 1, 0)]),
    ).toBeNull();
    expect(
      buildTableGrid([cell("unsafe", Number.MAX_SAFE_INTEGER, 0)]),
    ).toBeNull();
    expect(buildTableGrid([cell("sparse", 1_000_000, 0)])).toBeNull();
    expect(
      buildTableGrid([{ ...cell("missing", 0, 0), row_span: null }]),
    ).toBeNull();
  });
  it("groups table identifiers by physical page and excludes ordinary OCR lines", () => {
    const first = cell("one", 0, 0);
    const second = cell("two", 0, 0);
    expect(
      groupTableCells([
        { ...page, blocks: [page.blocks[0]!, first] },
        { ...page, page_number: 2, blocks: [second] },
      ]),
    ).toEqual([
      { id: "synthetic-table", page: 1, cells: [first] },
      { id: "synthetic-table", page: 2, cells: [second] },
    ]);
  });
  it.each([
    { row: null },
    { table_id: null },
    { row_span: 0 },
    { row: -1 },
    { row: Number.MAX_SAFE_INTEGER, row_span: 2 },
  ])(
    "rejects incomplete or unsafe cell metadata at the API boundary: %o",
    (invalid) => {
      expect(
        textBlockSchema.safeParse({ ...cell("invalid", 0, 0), ...invalid })
          .success,
      ).toBe(false);
    },
  );
});
