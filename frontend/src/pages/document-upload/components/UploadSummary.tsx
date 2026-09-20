import type { DocumentStage } from "@/pages/document-upload/types";

import { UploadIcon } from "@/components/UploadIcon";

interface UploadSummaryProps {
  needsReviewCount: number;
  readyCount: number;
  stageCounts: Record<DocumentStage, number>;
  totalFiles: number;
  totalKnownPages: number;
  unclassifiedCount: number;
}

const numberFormatter = new Intl.NumberFormat("ru-RU");

export function UploadSummary({
  needsReviewCount,
  readyCount,
  stageCounts,
  totalFiles,
  totalKnownPages,
  unclassifiedCount,
}: UploadSummaryProps) {
  return (
    <section className="border-border bg-card rounded-[20px] border p-5 shadow-sm sm:p-6">
      <h2 className="text-lg font-semibold">Сводка загрузки</h2>

      <dl className="divide-border mt-4 divide-y">
        <div className="flex items-center gap-4 py-3 first:pt-0">
          <span className="bg-accent/10 text-accent grid size-12 shrink-0 place-items-center rounded-full">
            <UploadIcon className="size-5.5" name="file" />
          </span>
          <div className="flex flex-col">
            <dt className="text-copy-muted order-2 text-sm">
              файлов загружено
            </dt>
            <dd className="order-1 text-2xl font-semibold tabular-nums">
              {numberFormatter.format(totalFiles)}
            </dd>
          </div>
        </div>

        <div className="flex items-center gap-4 py-3">
          <span className="bg-accent/10 text-accent grid size-12 shrink-0 place-items-center rounded-full">
            <UploadIcon className="size-5.5" name="template" />
          </span>
          <div className="flex flex-col">
            <dt className="text-copy-muted order-2 text-sm">
              страниц в PDF и DOCX
            </dt>
            <dd className="order-1 text-2xl font-semibold tabular-nums">
              {numberFormatter.format(totalKnownPages)}
            </dd>
          </div>
        </div>

        <div className="flex items-center gap-4 py-3">
          <span className="bg-success/10 text-success grid size-12 shrink-0 place-items-center rounded-full">
            <UploadIcon className="size-5.5" name="layers" />
          </span>
          <div className="min-w-0 flex-1">
            <dt className="text-copy-muted text-sm">Определено стадий</dt>
            <dd className="mt-2 flex flex-wrap gap-2 text-xs font-semibold">
              <span className="bg-surface-high rounded-full px-2.5 py-1">
                ПД {stageCounts.PD}
              </span>
              <span className="bg-surface-high rounded-full px-2.5 py-1">
                РД {stageCounts.RD}
              </span>
              <span className="bg-surface-high rounded-full px-2.5 py-1">
                ИД {stageCounts.ID}
              </span>
              {unclassifiedCount > 0 ? (
                <span className="bg-warning/10 text-foreground rounded-full px-2.5 py-1">
                  Не определено {unclassifiedCount}
                </span>
              ) : null}
            </dd>
          </div>
        </div>

        <div className="flex items-start gap-4 pt-3">
          <span className="bg-warning/10 text-foreground grid size-12 shrink-0 place-items-center rounded-full">
            <UploadIcon className="text-warning size-5.5" name="sparkles" />
          </span>
          <div>
            <dt className="text-copy-muted text-sm">
              Распознавание метаданных
            </dt>
            <dd className="mt-2 space-y-1.5 text-sm">
              <span className="text-foreground flex items-center gap-2">
                <span className="bg-success text-success-foreground grid size-4 place-items-center rounded-full">
                  <UploadIcon className="size-2.5" name="check" />
                </span>
                {readyCount} файлов готовы
              </span>
              <span className="text-foreground flex items-center gap-2">
                <span className="bg-warning size-2 rounded-full" />
                {needsReviewCount} требуют уточнения
              </span>
            </dd>
          </div>
        </div>
      </dl>
    </section>
  );
}
