import { Button } from "@heroui/react";
import { useEffect, useRef } from "react";

import type { RenderedPage, TextBlock } from "@/api/types/parsing";
import { isVisibleDocumentBlock } from "./document-blocks";
import { textBlockLabel } from "./parsing-labels";
import { RegionPanel } from "./RegionPanel";
import { TableBlocksPanel } from "./TableBlocksPanel";

export type TextView = "fragments" | "tables" | "document" | "regions";

export function TextBlocksPanel({
  blocks,
  pages,
  fullText,
  view,
  onView,
  selectedId,
  mode,
  onMode,
  onSelect,
  onTableSelect,
  page,
  selectedRegionId,
  onRegionSelect,
  onTableRegionSelect,
}: {
  blocks: TextBlock[];
  pages: RenderedPage[];
  fullText: string;
  view: TextView;
  onView: (view: TextView) => void;
  selectedId: string | null;
  mode: "normalized_text" | "raw_text";
  onMode: (mode: "normalized_text" | "raw_text") => void;
  onSelect: (id: string) => void;
  onTableSelect: (page: number, id: string) => void;
  page: RenderedPage;
  selectedRegionId: string | null;
  onRegionSelect: (id: string) => void;
  onTableRegionSelect: (page: number, id: string) => void;
}) {
  const visibleBlocks = blocks.filter(isVisibleDocumentBlock);
  const selected = visibleBlocks.find((block) => block.id === selectedId);
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId, view]);

  return (
    <aside
      className="border-border min-w-0 rounded-xl border p-4"
      aria-label="Извлечённый текст"
    >
      <div
        className="mb-3 flex flex-wrap gap-1"
        role="group"
        aria-label="Представление текста"
      >
        {(
          [
            ["fragments", "Фрагменты"],
            ["regions", "Области"],
            ["tables", "Таблицы"],
            ["document", "Весь документ"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            size="sm"
            variant={view === value ? "secondary" : "ghost"}
            aria-pressed={view === value}
            onPress={() => onView(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={mode === "normalized_text" ? "secondary" : "ghost"}
          aria-pressed={mode === "normalized_text"}
          onPress={() => onMode("normalized_text")}
        >
          Нормализованный
        </Button>
        <Button
          size="sm"
          variant={mode === "raw_text" ? "secondary" : "ghost"}
          aria-pressed={mode === "raw_text"}
          onPress={() => onMode("raw_text")}
        >
          Исходный
        </Button>
      </div>
      {view === "fragments" && (
        <p className="text-copy-muted mb-3 text-xs leading-5">
          Выберите фрагмент на странице или в тексте. Нормализация упорядочивает
          пробелы, сохраняя знаки и буквы.
        </p>
      )}
      {view === "regions" && (
        <RegionPanel
          page={page}
          selectedId={selectedRegionId}
          mode={mode}
          onSelect={onRegionSelect}
          onBlockSelect={onSelect}
        />
      )}
      {view === "document" && (
        <div>
          <p className="text-copy-muted mb-3 text-xs leading-5">
            Весь извлечённый текст, включая шапку, подписи и заключение. OCR и
            ячейки таблиц могут повторять одно содержимое; расхождения нужно
            сверять с оригиналом.
          </p>
          <p className="text-copy-muted mb-3 text-xs leading-5">
            Полный текст включает сохранённые надписи из графических и
            неопределённых областей. Наличие текста не означает, что он признан
            доказательством для проверки по матрице.
          </p>
          <div
            aria-label="Полный текст документа"
            className="max-h-[620px] overflow-auto text-sm leading-6 break-words whitespace-pre-wrap"
          >
            {fullText || "Читаемый текст не найден."}
          </div>
        </div>
      )}
      {view === "tables" && (
        <TableBlocksPanel
          pages={pages}
          selectedId={selectedId}
          mode={mode}
          onSelect={onTableSelect}
          onRegionSelect={onTableRegionSelect}
        />
      )}
      {view === "fragments" && visibleBlocks.length === 0 && (
        <p className="text-copy-muted py-6 text-sm">
          {page.regions
            ? "В основном представлении этой страницы нет текстовых фрагментов. Проверьте области и полный текст."
            : "На этой странице нет читаемого текста."}
        </p>
      )}
      {view === "fragments" && (
        <ol className="max-h-[620px] space-y-2 overflow-y-auto">
          {[...visibleBlocks]
            .sort((a, b) => a.order - b.order)
            .map((block) => (
              <li key={block.id}>
                {(block.kind === "table_cell" || block.source === "ocr") && (
                  <p className="text-copy-muted px-2 text-xs">
                    {textBlockLabel(block)}
                  </p>
                )}
                <button
                  type="button"
                  ref={selectedId === block.id ? selectedRef : undefined}
                  aria-pressed={selectedId === block.id}
                  onClick={() => onSelect(block.id)}
                  className={`w-full rounded-lg border p-2 text-left text-sm leading-6 break-words whitespace-pre-wrap ${selectedId === block.id ? "border-accent bg-accent/10" : "hover:bg-surface-high border-transparent"}`}
                >
                  {block[mode] || "Пустой фрагмент"}
                </button>
              </li>
            ))}
        </ol>
      )}
      {selected && view === "fragments" && (
        <div className="text-copy-muted border-border mt-4 space-y-2 border-t pt-3 text-xs leading-5">
          <p>
            Источник:{" "}
            {selected.source === "ocr"
              ? "распознавание изображения"
              : selected.source === "native"
                ? "текстовый слой"
                : "структура документа"}
          </p>
          {selected.confidence !== null && (
            <p>
              Уверенность модели: {Math.round(selected.confidence * 100)}%. Это
              не оценка точности.
            </p>
          )}
          {selected.structural_path && (
            <p className="break-all">
              Путь в документе:{" "}
              <span className="font-mono">{selected.structural_path}</span>
            </p>
          )}
          {selected.kind === "table_cell" && (
            <p>
              Ячейка таблицы · строка{" "}
              {selected.row === null ? "—" : selected.row + 1} · столбец{" "}
              {selected.column === null ? "—" : selected.column + 1}
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
