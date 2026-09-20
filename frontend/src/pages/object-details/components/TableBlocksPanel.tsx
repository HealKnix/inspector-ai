import { useEffect, useRef } from "react";

import type { RenderedPage, TextBlock } from "@/api/types/parsing";

import { buildTableGrid, groupTableCells } from "../lib/table-layout";
import { RegionTableStatus } from "./RegionTableStatus";

export function TableBlocksPanel({
  pages,
  selectedId,
  mode,
  onSelect,
  compact = false,
  onRegionSelect,
}: {
  pages: RenderedPage[];
  selectedId: string | null;
  mode: "normalized_text" | "raw_text";
  onSelect: (page: number, id: string) => void;
  compact?: boolean;
  onRegionSelect?: (page: number, id: string) => void;
}) {
  const tables = groupTableCells(pages);
  const tableRegions = pages.flatMap((page) =>
    (page.regions ?? [])
      .filter((region) => region.kind === "table")
      .map((region) => ({ page: page.page_number, region })),
  );
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({
      block: "nearest",
      inline: "nearest",
    });
  }, [selectedId]);

  function cellButton(cell: TextBlock, page: number) {
    return (
      <button
        ref={cell.id === selectedId ? selectedRef : undefined}
        type="button"
        aria-pressed={cell.id === selectedId}
        aria-label={`Страница ${page}, строка ${cell.row === null ? "—" : cell.row + 1}, столбец ${cell.column === null ? "—" : cell.column + 1}: ${cell[mode] || "Пустая ячейка"}`}
        onClick={() => onSelect(page, cell.id)}
        className={`w-full min-w-24 p-2 text-left text-sm leading-5 break-words whitespace-pre-wrap focus-visible:outline-2 focus-visible:outline-offset-[-2px] ${cell.id === selectedId ? "bg-accent/15 text-accent" : "hover:bg-surface-high"}`}
      >
        {cell[mode] || "Пустая ячейка"}
      </button>
    );
  }

  return (
    <div
      className="max-h-[620px] space-y-5 overflow-auto"
      aria-label="Распознанные таблицы"
    >
      {!compact && (
        <p className="text-copy-muted text-xs leading-5">
          Таблицы со всех страниц. Выберите ячейку, чтобы увидеть её область на
          странице. Текст вне таблиц доступен во фрагментах и полном тексте.
        </p>
      )}
      {!compact &&
        tableRegions
          .filter(({ region }) => region.table_status !== "structured")
          .map(({ page, region }) => (
            <section key={`${page}:${region.id}`} className="space-y-1">
              <h3 className="text-sm font-medium">
                Область таблицы · страница {page}
              </h3>
              <RegionTableStatus region={region} />
              {onRegionSelect && (
                <button
                  type="button"
                  onClick={() => onRegionSelect(page, region.id)}
                  className="text-accent text-sm underline underline-offset-4"
                >
                  Открыть область таблицы
                </button>
              )}
            </section>
          ))}
      {!tables.length && !tableRegions.length && (
        <p className="text-copy-muted text-sm">
          {pages.every((page) => page.regions !== undefined)
            ? "Табличные области не найдены. При сомнении проверьте оригинал."
            : "Структура таблиц не выделена. Проверьте извлечённый текст и оригинал."}
        </p>
      )}
      {tables.map((table, index) => {
        const grid = buildTableGrid(table.cells);
        const title = `Таблица ${index + 1} · страница ${table.page}`;
        return (
          <section
            key={`${table.page}:${table.id}`}
            aria-label={title}
            className="space-y-2"
          >
            <h3 className="text-sm font-semibold">{title}</h3>
            {grid ? (
              <div className="overflow-x-auto">
                {/* Native table supports both rowSpan and colSpan; HeroUI's grid lacks rowSpan. */}
                <table className="w-full border-collapse" aria-label={title}>
                  <tbody>
                    {grid.map((row, rowIndex) => (
                      <tr key={rowIndex}>
                        {row.map(({ column, block }) => (
                          <td
                            key={column}
                            rowSpan={block?.row_span ?? 1}
                            colSpan={block?.column_span ?? 1}
                            className="border-border border align-top"
                          >
                            {block ? (
                              cellButton(block, table.page)
                            ) : (
                              <span className="text-copy-muted block p-2 text-xs">
                                Ячейка не извлечена
                              </span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <>
                <p className="text-warning text-xs leading-5">
                  Сетку нельзя надёжно показать в этом окне. Все извлечённые
                  ячейки сохранены ниже списком.
                </p>
                <ul className="space-y-2">
                  {table.cells.map((cell) => (
                    <li
                      key={cell.id}
                      className="border-border rounded-lg border"
                    >
                      <p className="text-copy-muted px-2 pt-2 text-xs">
                        Строка {cell.row === null ? "—" : cell.row + 1} ·
                        столбец {cell.column === null ? "—" : cell.column + 1}
                      </p>
                      {cellButton(cell, table.page)}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
