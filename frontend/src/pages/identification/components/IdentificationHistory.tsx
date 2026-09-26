import {
  identificationErrorMessage,
  useIdentificationDocument,
} from "@/api/hooks/use-identification";
import { Button } from "@heroui/react";

export function IdentificationHistory({
  objectId,
  processId,
  runId,
  documentId,
  resolvedInputHash,
}: {
  objectId: string;
  processId: string;
  runId: string;
  documentId: string;
  resolvedInputHash?: string;
}) {
  const query = useIdentificationDocument(
    objectId,
    processId,
    runId,
    documentId,
    resolvedInputHash,
  );
  return (
    <section
      className="border-border space-y-3 border-t pt-4"
      aria-label="История уточнений"
    >
      <h3 className="font-semibold">История уточнений</h3>
      {query.isPending ? (
        <p role="status" className="text-copy-muted text-sm">
          Загружаем историю…
        </p>
      ) : query.error ? (
        <div role="alert">
          <p className="text-danger text-sm">
            {identificationErrorMessage(query.error)}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onPress={() => void query.refetch()}
          >
            Повторить загрузку истории
          </Button>
        </div>
      ) : query.data?.history.length ? (
        <ol className="space-y-3">
          {query.data.history.map((entry) => (
            <li
              key={entry.id}
              className="bg-surface-low rounded-lg p-3 text-sm"
            >
              <p>{entry.basis}</p>
              <p className="text-copy-muted mt-1 text-xs">
                Версия карточки {entry.card_version} ·{" "}
                {new Date(entry.created_at).toLocaleString("ru-RU")}
              </p>
              <details className="text-copy-muted mt-2 text-xs">
                <summary>Автор и запрос</summary>
                <p className="mt-1 break-all">
                  Автор: {entry.actor_id}
                  <br />
                  Запрос: {entry.request_id}
                  <br />
                  Запуск: {entry.run_id}
                </p>
              </details>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-copy-muted text-sm">
          В этом снимке уточнений инспектора ещё нет.
        </p>
      )}
    </section>
  );
}
