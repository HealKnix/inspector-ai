import { useEffect, useRef } from "react";

import type { RenderedPage } from "@/api/types/parsing";
import { hasVisibleDocumentContent } from "./document-blocks";
import { qualityReasonLabel } from "./parsing-labels";
import { methodLabels, regionKindLabels } from "./region-labels";
import { RegionTableStatus } from "./RegionTableStatus";
import { TableBlocksPanel } from "./TableBlocksPanel";

const tableStatusReasons = new Set([
  "TABLE_STRUCTURE_UNAVAILABLE",
  "TABLE_STRUCTURE_REJECTED",
  "TABLE_STRUCTURE_UNVERIFIED",
]);

export function RegionPanel({
  page,
  selectedId,
  mode,
  onSelect,
  onBlockSelect,
}: {
  page: RenderedPage;
  selectedId: string | null;
  mode: "normalized_text" | "raw_text";
  onSelect: (id: string) => void;
  onBlockSelect: (id: string) => void;
}) {
  const regions = page.regions ?? [];
  const selected = regions.find((region) => region.id === selectedId);
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId]);
  const blocks = selected
    ? page.blocks.filter(
        (block) =>
          block.region_id === selected.id && hasVisibleDocumentContent(block),
      )
    : [];
  const cells = blocks.filter((block) => block.kind === "table_cell");
  const visibleReasons =
    selected?.reasons.filter(
      (reason) =>
        !(
          (selected.table_status === "unconfirmed" ||
            selected.table_status === "unreadable") &&
          tableStatusReasons.has(reason)
        ),
    ) ?? [];
  return (
    <div aria-label="Области страницы" className="space-y-4">
      <p className="text-copy-muted text-xs leading-5">
        Выберите область на странице или в списке. Границы и типы определены
        автоматически и могут быть неточными.
      </p>
      {!page.regions && (
        <p className="text-copy-muted text-sm">
          Разметка областей для этого результата не выполнялась.
        </p>
      )}
      {page.regions && !regions.length && (
        <p className="text-copy-muted text-sm">
          Области на этой странице не выделены.
        </p>
      )}
      <ol className="max-h-60 space-y-2 overflow-auto">
        {regions.map((region, index) => (
          <li key={region.id}>
            <button
              type="button"
              ref={selectedId === region.id ? selectedRef : undefined}
              aria-pressed={selectedId === region.id}
              onClick={() => onSelect(region.id)}
              className={`w-full rounded-lg border p-3 text-left text-sm ${selectedId === region.id ? "border-accent bg-accent/10" : "border-border hover:bg-surface-high"}`}
            >
              <span className="block font-medium">
                {index + 1}. {regionKindLabels[region.kind]}
              </span>
              <span className="text-copy-muted mt-1 block text-xs">
                {methodLabels[region.method]}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {selected && (
        <section
          aria-label="Содержимое выбранной области"
          className="border-border space-y-3 border-t pt-4"
        >
          <h3 className="text-sm font-semibold">
            {regionKindLabels[selected.kind]}
          </h3>
          {selected.kind === "graphic" && (
            <p className="text-copy-muted text-sm leading-6">
              Графическая область сохранена для отдельного анализа. OCR её
              содержимого не выполнялся.
            </p>
          )}
          {selected.kind === "unknown" && (
            <p className="text-copy-muted text-sm leading-6">
              Тип области определить не удалось. Изображение и доступный
              текстовый слой сохранены; OCR не выполнялся.
            </p>
          )}
          <p className="text-copy-muted text-xs">
            {methodLabels[selected.method]}
          </p>
          <RegionTableStatus region={selected} />
          {visibleReasons.length > 0 && (
            <ul className="text-copy-muted space-y-1 text-xs leading-5">
              {visibleReasons.map((reason) => (
                <li key={reason}>{qualityReasonLabel(reason)}</li>
              ))}
            </ul>
          )}
          {blocks.some((block) => block.include_in_main === false) && (
            <p className="text-copy-muted text-xs leading-5">
              Часть надписей сохранена из текстового слоя и доступна в полном
              тексте, но не включена в основной список фрагментов.
            </p>
          )}
          {cells.length > 0 && (
            <TableBlocksPanel
              pages={[
                {
                  ...page,
                  blocks: cells.map((block) => ({
                    ...block,
                    include_in_main: true,
                  })),
                  regions: undefined,
                },
              ]}
              selectedId={null}
              mode={mode}
              onSelect={(_page, id) => onBlockSelect(id)}
              compact
            />
          )}
          <div className="max-h-80 space-y-2 overflow-auto text-sm leading-6 break-words whitespace-pre-wrap">
            {blocks
              .filter((block) => block.kind !== "table_cell")
              .map((block) => (
                <p key={block.id}>{block[mode]}</p>
              ))}
            {!blocks.length && (
              <p className="text-copy-muted">
                Извлечённого текста в области нет. Её изображение доступно слева
                на оригинальной странице.
              </p>
            )}
          </div>
          <details className="text-copy-muted text-xs leading-5">
            <summary className="cursor-pointer">
              Сведения об определении области
            </summary>
            <p>Класс Paddle: {selected.raw_class ?? "не определён"}</p>
            {selected.raw_score !== null && (
              <p>
                Оценка модели: {Math.round(selected.raw_score * 100)}%. Это не
                оценка точности.
              </p>
            )}
          </details>
        </section>
      )}
    </div>
  );
}
