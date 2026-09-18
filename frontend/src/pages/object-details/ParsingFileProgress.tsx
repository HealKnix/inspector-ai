import { ProgressBar } from "@heroui/react";

import type { ParsingFile } from "@/api/types/parsing";
import { parsingFailureLabel } from "./parsing-labels";

const phases: Record<string, string> = {
  checking_parser: "Проверяем готовность сервиса распознавания",
  waiting_models: "Ожидаем готовности моделей распознавания",
  waiting_capacity: "Ожидаем свободный обработчик",
  starting: "Запускаем обработку документа",
  checkpoint_verifying: "Проверяем сохранённые страницы",
  resuming: "Возобновляем обработку документа",
  rendering: "Подготавливаем изображения страниц",
  layout: "Определяем области страницы",
  extracting: "Извлекаем текст",
  ocr: "Распознаём текст",
  publishing: "Сохраняем результат",
  retry_delay: "Ожидаем автоматического продолжения обработки",
};
const waitingPhases: Partial<
  Record<NonNullable<ParsingFile["waiting_reason"]>, string>
> = {
  models_not_ready: phases.waiting_models,
  parser_busy: phases.waiting_capacity,
  retry_backoff: phases.retry_delay,
};
const pagePhases = new Set(["rendering", "layout", "extracting", "ocr"]);
const timestampFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function ProgressTime({ value }: { value: string }) {
  return (
    <time dateTime={value}>{timestampFormat.format(new Date(value))}</time>
  );
}

export function ParsingFileProgress({ file }: { file: ParsingFile }) {
  const active = file.state === "queued" || file.state === "processing";
  if (!active && file.state !== "failed") return null;
  const phase =
    active &&
    (file.waiting_reason
      ? waitingPhases[file.waiting_reason]
      : file.phase && (phases[file.phase] ?? `Этап обработки: ${file.phase}`));
  const historical =
    file.checkpoint_validated === false && file.pages_completed > 0;
  const hasProgress =
    file.pages_completed > 0 || Boolean(file.progress_updated_at);

  return (
    <div className="text-copy-muted mt-3 max-w-sm space-y-2 text-xs">
      {phase && (
        <p role="status" className="text-sm">
          {phase}
        </p>
      )}
      {active && file.progress_reset_reason && (
        <p className="text-warning">
          {file.progress_reset_reason === "pipeline_version_changed"
            ? "Версия обработки изменилась. Страницы обрабатываются заново."
            : "Часть сохранённых страниц недоступна или повреждена. Обрабатываем их повторно."}
        </p>
      )}
      {hasProgress ? (
        <>
          {Boolean(file.pages_total) && (
            <ProgressBar
              aria-label={`Последний подтверждённый прогресс: ${file.original_name}`}
              value={file.pages_completed}
              maxValue={file.pages_total!}
            >
              <ProgressBar.Track>
                <ProgressBar.Fill />
              </ProgressBar.Track>
            </ProgressBar>
          )}
          <p>
            Последний подтверждённый прогресс: {file.pages_completed}
            {file.pages_total !== null && ` из ${file.pages_total}`} страниц.
          </p>
          {historical && (
            <p>
              Это прогресс предыдущей попытки. Сохранённые страницы ещё не
              проверены в этой попытке.
            </p>
          )}
        </>
      ) : active ? (
        <p>Подтверждённого прогресса по страницам пока нет.</p>
      ) : null}
      {file.progress_updated_at && (
        <p>
          Последнее обновление прогресса:{" "}
          <ProgressTime value={file.progress_updated_at} />.
        </p>
      )}
      {active &&
        file.checkpoint_validated === true &&
        file.checkpoint_pages !== null &&
        file.checkpoint_pages !== undefined && (
          <p>Сохранённые страницы проверены: {file.checkpoint_pages}.</p>
        )}
      {active &&
        !file.waiting_reason &&
        file.phase &&
        pagePhases.has(file.phase) &&
        file.current_page && (
          <p>
            Текущая страница: {file.current_page}
            {file.pages_total !== null && ` из ${file.pages_total}`}.
          </p>
        )}
      {active && file.retry_at && (
        <p>
          Следующая попытка — не ранее <ProgressTime value={file.retry_at} />.
        </p>
      )}
      {active && file.previous_attempt_error && (
        <p>
          Предыдущая попытка: {parsingFailureLabel(file.previous_attempt_error)}
        </p>
      )}
    </div>
  );
}
