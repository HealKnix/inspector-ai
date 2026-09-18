import { Button } from "@heroui/react";
import { useEffect, useRef } from "react";

import type { TextBlock } from "@/api/types/parsing";

export function TextBlocksPanel({
  blocks,
  selectedId,
  mode,
  onMode,
  onSelect,
}: {
  blocks: TextBlock[];
  selectedId: string | null;
  mode: "normalized_text" | "raw_text";
  onMode: (mode: "normalized_text" | "raw_text") => void;
  onSelect: (id: string) => void;
}) {
  const selected = blocks.find((block) => block.id === selectedId);
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId]);

  return (
    <aside
      className="border-border min-w-0 rounded-xl border p-4"
      aria-label="Извлечённый текст"
    >
      <div className="mb-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={mode === "normalized_text" ? "secondary" : "ghost"}
          onPress={() => onMode("normalized_text")}
        >
          Нормализованный
        </Button>
        <Button
          size="sm"
          variant={mode === "raw_text" ? "secondary" : "ghost"}
          onPress={() => onMode("raw_text")}
        >
          Исходный
        </Button>
      </div>
      <p className="text-copy-muted mb-3 text-xs leading-5">
        Выберите фрагмент на странице или в тексте. Нормализация упорядочивает
        пробелы, сохраняя знаки и буквы.
      </p>
      {blocks.length === 0 && (
        <p className="text-copy-muted py-6 text-sm">
          На этой странице нет читаемого текста.
        </p>
      )}
      <ol className="max-h-[620px] space-y-2 overflow-y-auto">
        {[...blocks]
          .sort((a, b) => a.order - b.order)
          .map((block) => (
            <li key={block.id}>
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
      {selected && (
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
