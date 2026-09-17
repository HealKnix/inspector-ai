import type { DocumentStage } from "@/pages/document-upload/types";

import { UploadIcon } from "./UploadIcon";

interface CompletenessPanelProps {
  hasDocuments: boolean;
  missingRequiredSourceParameterCount: number;
  showMockFindings: boolean;
  stageCounts: Record<DocumentStage, number>;
}

const stageLabels: Array<{ label: string; stage: DocumentStage }> = [
  { label: "Проектная документация", stage: "PD" },
  { label: "Рабочая документация", stage: "RD" },
  { label: "Исполнительная документация", stage: "ID" },
];

export function CompletenessPanel({
  hasDocuments,
  missingRequiredSourceParameterCount,
  showMockFindings,
  stageCounts,
}: CompletenessPanelProps) {
  return (
    <section className="border-border bg-card rounded-[20px] border p-5 shadow-sm sm:p-6">
      <h2 className="text-lg font-semibold">Проверка комплектности</h2>

      <dl className="divide-border border-border mt-4 divide-y overflow-hidden rounded-[14px] border">
        {stageLabels.map(({ label, stage }) => (
          <div
            className="grid grid-cols-[42px_1fr_auto] items-center gap-3 px-3 py-3"
            key={stage}
          >
            <dt className="font-semibold">{stage === "ID" ? "ИД" : stage}</dt>
            <dd className="text-copy-muted min-w-0 truncate text-xs">
              {label}
            </dd>
            <dd className="flex items-center gap-2 text-xs font-medium">
              <span
                className={`grid size-5 place-items-center rounded-full ${
                  stageCounts[stage] > 0
                    ? "bg-success text-success-foreground"
                    : "bg-surface-raised text-copy-muted"
                }`}
              >
                {stageCounts[stage] > 0 ? (
                  <UploadIcon className="size-3" name="check" />
                ) : (
                  "—"
                )}
              </span>
              {stageCounts[stage] > 0
                ? `${stageCounts[stage]} файлов`
                : "Нет файлов"}
            </dd>
          </div>
        ))}
      </dl>

      {showMockFindings ? (
        <div className="bg-warning/10 text-foreground mt-4 flex gap-3 rounded-[14px] px-4 py-3">
          <UploadIcon className="mt-0.5 size-5 shrink-0" name="warning" />
          <div>
            <p className="text-sm font-semibold">
              Для {missingRequiredSourceParameterCount} контрольных параметров
            </p>
            <p className="mt-0.5 text-xs leading-5">
              Не найдены обязательные источники
            </p>
          </div>
        </div>
      ) : hasDocuments ? (
        <div className="bg-surface-high text-copy-muted mt-4 rounded-[14px] px-4 py-3 text-sm leading-5">
          Источники для контрольных параметров будут оценены после обработки.
        </div>
      ) : (
        <div className="bg-surface-high text-copy-muted mt-4 rounded-[14px] px-4 py-3 text-sm">
          Добавьте документы для предварительной оценки состава.
        </div>
      )}

      <p className="text-copy-muted mt-4 text-xs leading-5">
        {hasDocuments
          ? "Предварительная оценка построена по загруженным файлам. Эталонный состав объекта не подключён, поэтому система не показывает неподтверждённые знаменатели."
          : "Эталонный состав объекта не подключён. После загрузки будут показаны только подтверждённые количества файлов."}
      </p>
    </section>
  );
}
