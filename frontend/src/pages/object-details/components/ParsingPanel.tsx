import { Button } from "@heroui/react";

import {
  parsingErrorMessage,
  type useParsingStatus,
} from "@/api/hooks/use-parsing";
import type { ParsingFile } from "@/api/types/parsing";
import { ParsingFileProgress } from "./ParsingFileProgress";
import { RetryParsingButton } from "./RetryParsingButton";
import {
  parsingFailureLabel,
  parsingStateLabels,
  qualityLabels,
  qualityReasonLabel,
} from "./parsing-labels";

export function ParsingPanel({
  objectId,
  query,
  onOpen,
}: {
  objectId: string;
  query: ReturnType<typeof useParsingStatus>;
  onOpen: (file: ParsingFile) => void;
}) {
  const data = query.isError ? undefined : query.data;
  const completed =
    data?.items.filter((file) => file.state === "succeeded").length ?? 0;
  const failed =
    data?.items.filter((file) => file.state === "failed").length ?? 0;

  return (
    <section
      className="border-border bg-card overflow-hidden rounded-[20px] border"
      aria-labelledby="parsing-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-5">
        <div>
          <h2 id="parsing-title" className="text-lg font-semibold">
            Чтение документов
          </h2>
          <p className="text-copy-muted mt-1 text-xs leading-5">
            Текущие обработки комплектов. Извлечённый текст ещё не является
            результатом проверки.
          </p>
        </div>
        {data && (
          <span className="bg-surface-high text-copy-muted rounded-full px-3 py-1 text-xs">
            {data.active ? "Обработка продолжается" : "Активных обработок нет"}
          </span>
        )}
      </div>
      {query.isPending && (
        <p role="status" className="text-copy-muted px-5 pb-5 text-sm">
          Загружаем состояние обработки…
        </p>
      )}
      {query.error && (
        <div role="alert" className="space-y-3 px-5 pb-5">
          <p className="text-danger text-sm">
            {parsingErrorMessage(query.error)}
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
            Обновить состояние
          </Button>
        </div>
      )}
      {data && data.items.length === 0 && (
        <p className="text-copy-muted px-5 pb-5 text-sm">
          Документов для обработки пока нет.
        </p>
      )}
      {data && data.items.length > 0 && (
        <>
          <p className="text-copy-muted px-5 pb-4 text-sm">
            Всего {data.items.length} · обработано {completed} · с ошибкой{" "}
            {failed}
          </p>
          <ul className="divide-border divide-y">
            {data.items.map((file) => (
              <li
                key={`${file.run_id}:${file.file_id}`}
                className="flex flex-wrap items-start justify-between gap-4 px-5 py-4"
              >
                <div className="min-w-0 flex-1 basis-64">
                  <p className="font-medium break-words">
                    {file.original_name}
                  </p>
                  <p
                    className={`mt-1 text-sm ${file.state === "failed" ? "text-danger" : "text-copy-muted"}`}
                  >
                    {parsingStateLabels[file.state]}
                    {file.attempt > 0 && ` · попытка ${file.attempt}`}
                  </p>
                  <ParsingFileProgress file={file} />
                  {file.quality && (
                    <p
                      className={`mt-2 text-sm ${file.quality === "OK" ? "text-copy-muted" : "text-warning"}`}
                    >
                      {qualityLabels[file.quality]}
                    </p>
                  )}
                  {file.reasons.length > 0 && (
                    <ul className="text-copy-muted mt-2 space-y-1 text-xs">
                      {file.reasons.map((reason, index) => (
                        <li key={`${index}:${reason}`}>
                          {qualityReasonLabel(reason)}
                        </li>
                      ))}
                    </ul>
                  )}
                  {file.state === "failed" && (
                    <p role="alert" className="text-danger mt-2 text-sm">
                      {parsingFailureLabel(file.error_code)}
                    </p>
                  )}
                  <details className="text-copy-muted mt-3 text-xs">
                    <summary className="cursor-pointer">
                      Сведения об обработке
                    </summary>
                    <dl className="mt-2 space-y-1 break-all">
                      <div>
                        <dt className="inline">Процесс: </dt>
                        <dd className="inline font-mono">{file.process_id}</dd>
                      </div>
                      <div>
                        <dt className="inline">Текущий запуск: </dt>
                        <dd className="inline font-mono">{file.run_id}</dd>
                      </div>
                      {file.error_code && (
                        <div>
                          <dt className="inline">Код ошибки: </dt>
                          <dd className="inline font-mono">
                            {file.error_code}
                          </dd>
                        </div>
                      )}
                    </dl>
                  </details>
                </div>
                <div className="flex flex-wrap gap-2">
                  {file.state === "succeeded" && file.artifact_id && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="rounded-xl"
                      aria-label={`Открыть страницы: ${file.original_name}`}
                      onPress={() => onOpen(file)}
                    >
                      Открыть страницы
                    </Button>
                  )}
                  <RetryParsingButton
                    key={`${file.run_id}:${file.file_id}:${file.state}:${file.attempt}:${file.artifact_id ?? ""}`}
                    objectId={objectId}
                    file={file}
                  />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
