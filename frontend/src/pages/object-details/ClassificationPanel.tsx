import { Button } from "@heroui/react";

import {
  classificationErrorMessage,
  type useClassificationStatus,
} from "@/api/hooks/use-classification";
import type {
  ClassificationEvidence,
  ClassificationFile,
} from "@/api/types/classification";
import type { ParsingFile } from "@/api/types/parsing";
import { RetryClassificationButton } from "./RetryClassificationButton";
import {
  classificationFailureLabel,
  classificationReasonLabel,
  classificationStageLabels,
  classificationStateLabels,
} from "./classification-labels";

export function ClassificationPanel({
  objectId,
  query,
  parsingFiles,
  onEvidence,
}: {
  objectId: string;
  query: ReturnType<typeof useClassificationStatus>;
  parsingFiles: ParsingFile[] | undefined;
  onEvidence: (
    file: ClassificationFile,
    evidence: ClassificationEvidence,
  ) => void;
}) {
  const data = query.isError ? undefined : query.data;
  const currentItems =
    data?.items.filter((file) =>
      parsingFiles?.some(
        (parsed) =>
          parsed.file_id === file.file_id &&
          parsed.run_id === file.run_id &&
          parsed.artifact_id === file.artifact_id &&
          parsed.state === "succeeded",
      ),
    ) ?? [];
  return (
    <section
      className="border-border bg-card overflow-hidden rounded-[20px] border"
      aria-labelledby="classification-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-5">
        <div>
          <h2 id="classification-title" className="text-lg font-semibold">
            Принадлежность документации
          </h2>
          <p className="text-copy-muted mt-1 text-xs leading-5">
            Проектная, рабочая или исполнительная документация — по содержимому
            и подтверждающим фрагментам.
          </p>
        </div>
        {data?.active && (
          <span className="bg-surface-high text-copy-muted rounded-full px-3 py-1 text-xs">
            Классификация продолжается
          </span>
        )}
      </div>
      {query.isPending && (
        <p role="status" className="text-copy-muted px-5 pb-5 text-sm">
          Загружаем классификацию…
        </p>
      )}
      {query.error && (
        <div role="alert" className="space-y-3 px-5 pb-5">
          <p className="text-danger text-sm">
            {classificationErrorMessage(query.error)}
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
            Обновить классификацию
          </Button>
        </div>
      )}
      {data && currentItems.length === 0 && (
        <p className="text-copy-muted px-5 pb-5 text-sm">
          Результаты появятся после чтения документов.
        </p>
      )}
      {data && currentItems.length > 0 && (
        <ul className="divide-border divide-y">
          {currentItems.map((file) => {
            const configurationChanged =
              file.error_code === "classification_configuration_changed";
            const result = file.state === "succeeded" ? file.result : null;
            const reasons = [
              ...new Set(result?.reasons.map(classificationReasonLabel)),
            ];
            return (
              <li
                key={`${objectId}:${file.run_id}:${file.file_id}:${file.artifact_id}`}
                className="flex flex-wrap items-start justify-between gap-4 px-5 py-4"
              >
                <div className="min-w-0 flex-1 basis-64">
                  <h3 className="font-medium break-words">
                    {file.original_name}
                  </h3>
                  <p className="text-copy-muted mt-1 text-sm">
                    {configurationChanged
                      ? "Настройки классификации изменились. Запустите повтор с текущими настройками."
                      : classificationStateLabels[file.state]}
                  </p>
                  {file.state === "failed" && !configurationChanged && (
                    <p role="alert" className="text-danger mt-2 text-sm">
                      {classificationFailureLabel(file.error_code)}
                    </p>
                  )}
                  {result && (
                    <div className="mt-3 space-y-2 text-sm">
                      <p className="font-medium">
                        {result.stage
                          ? classificationStageLabels[result.stage]
                          : "Принадлежность не определена"}
                      </p>
                      {result.document_kind && (
                        <p className="break-words">{result.document_kind}</p>
                      )}
                      {result.method !== "none" && (
                        <p className="text-copy-muted">
                          {result.method === "llm"
                            ? "Модель · Предложено моделью"
                            : "Правила"}
                        </p>
                      )}
                      {result.needs_review && (
                        <p className="text-warning font-medium">
                          Требует уточнения
                        </p>
                      )}
                      {result.needs_review && reasons.length > 0 && (
                        <ul className="text-copy-muted space-y-1 text-xs">
                          {reasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      )}
                      {result.evidence.length > 0 && (
                        <details className="text-copy-muted pt-1">
                          <summary className="cursor-pointer">
                            Признаки в документе ({result.evidence.length})
                          </summary>
                          <ul className="mt-3 space-y-3">
                            {result.evidence.map((evidence, index) => (
                              <li
                                key={`${evidence.page_number}:${evidence.block_id}:${index}`}
                                className="border-border border-l-2 pl-3"
                              >
                                <blockquote className="text-copy break-words whitespace-pre-wrap">
                                  {evidence.quote}
                                </blockquote>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="mt-1"
                                  aria-label={`Открыть признак ${index + 1}: ${file.original_name}, страница ${evidence.page_number}`}
                                  onPress={() => onEvidence(file, evidence)}
                                >
                                  Страница {evidence.page_number}
                                </Button>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </div>
                  )}
                </div>
                <RetryClassificationButton
                  key={`${objectId}:${file.file_id}:${file.artifact_id}:${file.task_id ?? ""}:${file.state}`}
                  objectId={objectId}
                  file={file}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
