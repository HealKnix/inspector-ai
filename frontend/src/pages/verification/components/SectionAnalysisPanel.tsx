import { Button } from "@heroui/react";

import type {
  SectionAnalysisStatus,
  SectionAnalysisTask,
} from "@/api/types/section-analysis";

const taskPresentation: Record<
  SectionAnalysisTask["state"],
  { label: string; className: string; dotClassName: string }
> = {
  queued: {
    label: "В очереди",
    className: "bg-warning/10 text-foreground",
    dotClassName: "bg-warning",
  },
  processing: {
    label: "Выполняется",
    className: "bg-warning/10 text-foreground",
    dotClassName: "bg-warning",
  },
  succeeded: {
    label: "Завершён",
    className: "bg-success/10 text-foreground",
    dotClassName: "bg-success",
  },
  failed: {
    label: "Ошибка",
    className: "bg-danger/10 text-foreground",
    dotClassName: "bg-danger",
  },
};

function taskStateText(state: SectionAnalysisTask["state"]): string {
  switch (state) {
    case "queued":
      return "Задача поставлена в очередь — страница обновляется автоматически.";
    case "processing":
      return "Выполняется сравнение разделов — страница обновляется автоматически.";
    case "failed":
      return "Анализ разделов завершился ошибкой — результат не пригоден для выводов. Запустите задачу заново.";
    default:
      return "";
  }
}

export interface SectionAnalysisPanelProps {
  status: SectionAnalysisStatus | undefined;
  statusLoading: boolean;
  statusError: string | null;
  onRetryStatus: () => void;
  /** Parent resolves guards (enabled, current run, published snapshot, role). */
  canStart: boolean;
  startBlockedReason: string | null;
  onStart: () => void;
  starting: boolean;
  startError: string | null;
  /** Succeeded analysis is newer than the protocol snapshot being viewed. */
  staleResults: boolean;
}

/**
 * Start/progress/error controls for the section-first LLM comparison. The
 * panel renders nothing while the feature is disabled and no historical task
 * exists; stored tasks stay visible after the flag turns off.
 */
export function SectionAnalysisPanel({
  status,
  statusLoading,
  statusError,
  onRetryStatus,
  canStart,
  startBlockedReason,
  onStart,
  starting,
  startError,
  staleResults,
}: SectionAnalysisPanelProps) {
  if (statusLoading && !status) {
    return (
      <section
        aria-label="Анализ разделов"
        className="border-border bg-card mt-4 rounded-xl border p-4"
      >
        <p className="text-copy-muted text-sm" role="status">
          Загружаем состояние анализа разделов…
        </p>
      </section>
    );
  }
  if (statusError && !status) {
    return (
      <section
        aria-label="Анализ разделов"
        className="border-border bg-card mt-4 rounded-xl border p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-danger text-sm" role="alert">
            {statusError}
          </p>
          <Button onPress={onRetryStatus} size="sm" variant="secondary">
            Повторить
          </Button>
        </div>
      </section>
    );
  }
  if (!status) return null;
  if (!status.enabled && !status.task && !status.results) return null;

  const task = status.task;
  const results = status.results;
  const contexts = results?.contexts ?? [];
  const parameters = contexts.reduce(
    (count, context) => count + context.parameters.length,
    0,
  );
  const incomplete = contexts.filter(
    (context) => !context.coverage.complete,
  ).length;
  const startLabel =
    task && task.state !== "queued"
      ? "Запустить заново"
      : "Запустить анализ разделов";
  // Повторный запуск над актуальным результатом только возвращает кэш —
  // кнопка остаётся для failed/stale задач и отсутствующего результата.
  const canStartTask =
    canStart && (!task || task.state === "failed" || task.stale || !results);
  const stateBadge = task?.stale
    ? {
        label: "Устарел",
        className: "bg-danger/10 text-foreground",
        dotClassName: "bg-danger",
      }
    : task
      ? taskPresentation[task.state]
      : null;

  return (
    <section
      aria-label="Анализ разделов"
      className="border-border bg-card mt-4 rounded-xl border p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Анализ разделов</h2>
          <p className="text-copy-muted mt-1 max-w-2xl text-sm">
            Предварительное сравнение разделов документов по параметрам матрицы.
            Результат — ориентир для инспектора: нарушение он не подтверждает.
          </p>
        </div>
        {task && stateBadge && (
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${stateBadge.className}`}
          >
            <span
              className={`size-1.5 rounded-full ${stateBadge.dotClassName}`}
            />
            {stateBadge.label}
          </span>
        )}
      </div>

      {task && taskStateText(task.state) && (
        <p className="mt-3 text-sm" role="status">
          {taskStateText(task.state)}
        </p>
      )}
      {task?.stale && (
        <p className="text-warning mt-3 text-sm" role="status">
          Сохранённый результат устарел для текущих настроек или исходных данных
          и не может служить основанием — запустите анализ заново.
        </p>
      )}

      {results && task?.state === "succeeded" && !task.stale && (
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-copy-muted">Областей сравнения</dt>
            <dd className="font-semibold">{contexts.length}</dd>
          </div>
          <div>
            <dt className="text-copy-muted">Параметров с ответом</dt>
            <dd className="font-semibold">{parameters}</dd>
          </div>
          <div>
            <dt className="text-copy-muted">Пропущено областей</dt>
            <dd className="font-semibold">{results.skipped_contexts.length}</dd>
          </div>
        </dl>
      )}

      {incomplete > 0 && (
        <p className="text-warning mt-3 text-sm">
          {`Для ${incomplete} областей контекст проверен не полностью — такие результаты помечены как неполные.`}
        </p>
      )}
      {results && results.failures.length > 0 && (
        <p className="text-warning mt-3 text-sm">
          {`Часть запросов анализа завершилась ошибкой (${results.failures.length}) — затронутые параметры не получили вывода.`}
        </p>
      )}
      {staleResults && (
        <p className="text-warning mt-3 text-sm" role="alert">
          Результаты анализа новее показанного протокола. Сформируйте протокол
          заново, чтобы перенести их в находки.
        </p>
      )}
      {!status.current && (
        <p className="text-copy-muted mt-3 text-sm">
          Состояние относится к устаревшей обработке — запуск доступен для
          актуального запуска.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {status.enabled && canStartTask && (
          <Button
            isDisabled={starting}
            isPending={starting}
            onPress={onStart}
            size="sm"
          >
            {startLabel}
          </Button>
        )}
        {status.enabled && !canStart && startBlockedReason && (
          <p className="text-copy-muted text-sm">{startBlockedReason}</p>
        )}
        {!status.enabled && (
          <p className="text-copy-muted text-sm">
            Анализ разделов отключён настройками сервиса — сохранённые
            результаты остаются доступными.
          </p>
        )}
      </div>
      {startError && (
        <p className="text-danger mt-3 text-sm" role="alert">
          {startError}
        </p>
      )}
      {statusError && status && (
        <p className="text-danger mt-3 text-sm" role="alert">
          {statusError}
        </p>
      )}
    </section>
  );
}
