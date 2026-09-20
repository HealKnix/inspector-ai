import { Button } from "@heroui/react";

import {
  extractionErrorMessage,
  type useExtractions,
} from "@/api/hooks/use-extraction";
import type {
  ExtractionEvidence,
  ExtractionItem,
} from "@/api/types/extraction";
import {
  extractionStageLabels,
  extractionStatusLabels,
} from "./extraction-labels";

function formatValue(item: ExtractionItem) {
  if (item.value === null || item.value === undefined) return "—";
  const unit = item.unit ? ` ${item.unit}` : "";
  return `${typeof item.value === "number" ? item.value.toLocaleString("ru-RU") : item.value}${unit}`;
}

export function ExtractionPanel({
  objectId,
  query,
  onEvidence,
}: {
  objectId: string;
  query: ReturnType<typeof useExtractions>;
  onEvidence: (item: ExtractionItem, evidence: ExtractionEvidence) => void;
}) {
  const data = query.isError ? undefined : query.data;
  const byParameter = new Map<string, ExtractionItem[]>();
  for (const item of data?.items ?? []) {
    const list = byParameter.get(item.parameter_code) ?? [];
    list.push(item);
    byParameter.set(item.parameter_code, list);
  }
  const parameters = [...byParameter.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return (
    <section
      className="border-border bg-card overflow-hidden rounded-[20px] border"
      aria-labelledby="extraction-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-5">
        <div>
          <h2 id="extraction-title" className="text-lg font-semibold">
            Извлечённые параметры
          </h2>
          <p className="text-copy-muted mt-1 text-xs leading-5">
            Значения контрольной матрицы по утверждённым правилам. Извлечение —
            не вердикт о нарушении: несколько значений и отсутствие
            доказательств показываются явно.
          </p>
        </div>
        {data?.active && (
          <span className="bg-surface-high text-copy-muted rounded-full px-3 py-1 text-xs">
            Извлечение продолжается
          </span>
        )}
      </div>
      {query.isPending && (
        <p role="status" className="text-copy-muted px-5 pb-5 text-sm">
          Загружаем результаты извлечения…
        </p>
      )}
      {query.error && (
        <div role="alert" className="space-y-3 px-5 pb-5">
          <p className="text-danger text-sm">
            {extractionErrorMessage(query.error)}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="rounded-xl"
            isPending={query.isFetching}
            onPress={() => {
              void query.refetch();
            }}
          >
            Обновить
          </Button>
        </div>
      )}
      {data && parameters.length === 0 && !data.active && (
        <p className="text-copy-muted px-5 pb-5 text-sm">
          {data.ruleset_fingerprint
            ? "Извлечения пока нет — результаты появятся после обработки."
            : "Нет утверждённых правил извлечения — параметры не проверялись."}
        </p>
      )}
      {parameters.length > 0 && (
        <ul className="divide-border divide-y">
          {parameters.map(([code, items]) => (
            <li key={`${objectId}:${code}`} className="px-5 py-4">
              <h3 className="font-medium break-words">
                {code}
                <span className="text-copy-muted ml-2 text-xs font-normal">
                  {items[0]?.original_name
                    ? `по ${items.length} документу(ам)`
                    : ""}
                </span>
              </h3>
              <ul className="mt-3 space-y-3">
                {items.map((item) => (
                  <li
                    key={item.id}
                    className="border-border border-l-2 pl-3 text-sm"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-medium break-words">
                        {item.original_name}
                      </span>
                      <span className="text-copy-muted text-xs">
                        {item.stage
                          ? extractionStageLabels[item.stage]
                          : "стадия не определена"}
                      </span>
                    </div>
                    <p className="mt-1">
                      <span
                        className={
                          item.status === "extracted"
                            ? "text-success font-medium"
                            : item.status === "ambiguous"
                              ? "text-warning font-medium"
                              : "text-copy-muted"
                        }
                      >
                        {extractionStatusLabels[item.status]}
                      </span>
                      {item.status === "extracted" && (
                        <span className="ml-2 font-medium">
                          {formatValue(item)}
                        </span>
                      )}
                    </p>
                    {item.status === "ambiguous" && item.alternatives && (
                      <ul className="text-copy-muted mt-1 space-y-0.5 text-xs">
                        {item.alternatives.map((alt, index) => (
                          <li key={index}>
                            Вариант {index + 1}: {String(alt.value ?? "—")}
                            {alt.unit ? ` ${alt.unit}` : ""}
                          </li>
                        ))}
                      </ul>
                    )}
                    {item.evidence.length > 0 && (
                      <details className="text-copy-muted pt-1">
                        <summary className="cursor-pointer">
                          Доказательства ({item.evidence.length})
                        </summary>
                        <ul className="mt-3 space-y-3">
                          {item.evidence.map((evidence, index) => (
                            <li
                              key={`${item.id}:${index}`}
                              className="border-border border-l-2 pl-3"
                            >
                              <blockquote className="text-copy break-words whitespace-pre-wrap">
                                {evidence.quote}
                              </blockquote>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="mt-1"
                                aria-label={`Открыть доказательство ${index + 1}: ${item.original_name}, страница ${evidence.page_number}`}
                                onPress={() => onEvidence(item, evidence)}
                              >
                                Страница {evidence.page_number}
                                {evidence.table_id
                                  ? ` · таблица ${evidence.table_row !== null ? `строка ${evidence.table_row}` : ""}`
                                  : ""}
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
