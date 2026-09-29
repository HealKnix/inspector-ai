import { useParsingStatus } from "@/api/hooks/use-parsing";
import type { IdentificationRegistry } from "@/api/types/identification";
import { IdentificationSelect } from "@/components/identification-select/IdentificationSelect";
import routeNames from "@/routes/routeNames";
import { Button } from "@heroui/react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { identificationCanApply } from "../lib/identification";
import { reviewDocumentName } from "../lib/review-card";
import { DocumentReview } from "./DocumentReview";

export function RegistryWorkspace({
  objectId,
  registry,
  params,
  onParams,
  onReload,
  unavailable,
}: {
  objectId: string;
  registry: IdentificationRegistry;
  params: URLSearchParams;
  onParams: (params: URLSearchParams, options?: { replace?: boolean }) => void;
  onReload: () => Promise<boolean>;
  unavailable: boolean;
}) {
  const files = useParsingStatus(objectId);
  const filenames = new Map(
    files.data?.items.map((file) => [file.file_id, file.original_name]),
  );
  const [refresh, setRefresh] = useState(0);
  const selectedId = params.get("documentId");
  const selectedRevisionId = params.get("revisionId");
  // A document has one alias per revision. Never let its first alias override
  // an explicit source or canonical revision from a saved link.
  const aliases = registry.document_aliases?.filter(
    (item) => item.document_id === selectedId,
  );
  const alias = selectedRevisionId
    ? (aliases?.find((item) => item.revision_id === selectedRevisionId) ??
      aliases?.find(
        (item) => item.canonical_revision_id === selectedRevisionId,
      ))
    : aliases?.[0];
  const document =
    registry.documents.find(
      (item) =>
        item.document_id === (alias?.canonical_document_id ?? selectedId),
    ) ??
    (!selectedId
      ? (registry.documents.find((item) =>
          item.revisions.some((revision) =>
            revision.representations.some(
              (file) => file.file_id === params.get("fileId"),
            ),
          ),
        ) ?? registry.documents[0])
      : undefined);
  const revision =
    document?.revisions.find(
      (item) =>
        item.revision_id ===
        (alias?.canonical_revision_id ?? selectedRevisionId),
    ) ?? (!selectedRevisionId ? document?.revisions[0] : undefined);
  const navigate = (documentId: string, revisionId?: string) => {
    if (!documentId) return;
    const next = new URLSearchParams(params);
    next.set("processId", registry.process_id);
    next.set("runId", registry.run_id);
    next.set("documentId", documentId);
    next.delete("fileId");
    if (revisionId) next.set("revisionId", revisionId);
    else next.delete("revisionId");
    onParams(next, { replace: true });
  };
  const openCurrent = () => {
    const next = new URLSearchParams(params);
    next.set("runId", registry.current_run_id);
    next.delete("resolvedInputHash");
    onParams(next);
  };
  return (
    <div className="mt-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <Link
          className="text-accent underline"
          to={routeNames.DOCUMENT_VERIFICATION_DETAILS(objectId)}
        >
          Результаты проверки
        </Link>
        <details className="max-w-xl">
          <summary className="text-copy-muted cursor-pointer">
            История расчётов
          </summary>
          <div className="space-y-3 py-3">
            <p>
              {registry.current
                ? "Открыт текущий расчёт"
                : "Открыт предыдущий расчёт"}
            </p>
            {(registry.snapshot_versions?.length ?? 0) > 1 ? (
              <IdentificationSelect
                label="Снимок документов"
                value={registry.resolved_input_hash ?? ""}
                options={(registry.snapshot_versions ?? []).map((snapshot) => ({
                  id: snapshot.resolved_input_hash,
                  label: `Снимок ${snapshot.version} · ${new Date(snapshot.created_at).toLocaleString("ru-RU")}`,
                }))}
                onChange={(hash) => {
                  const next = new URLSearchParams(params);
                  next.set("runId", registry.run_id);
                  if (hash) next.set("resolvedInputHash", hash);
                  else next.delete("resolvedInputHash");
                  onParams(next, { replace: true });
                }}
              />
            ) : null}
            {!registry.current ? (
              <Button variant="outline" size="sm" onPress={openCurrent}>
                Открыть текущий расчёт
              </Button>
            ) : null}
          </div>
        </details>
      </div>
      {registry.active ? (
        <p role="status" className="text-copy-muted text-sm">
          Документы обрабатываются. Результаты появятся автоматически.
        </p>
      ) : null}
      {registry.error_code ? (
        <p role="alert" className="text-danger text-sm">
          Обработка не завершилась. Сохранённые сведения доступны для просмотра.
        </p>
      ) : null}
      {!identificationCanApply(registry) ? (
        <p className="text-copy-muted text-sm">
          Только просмотр:{" "}
          {registry.process_status === "FINALIZED"
            ? "протокол финализирован"
            : !registry.current
              ? "выбран предыдущий расчёт"
              : registry.active || registry.process_status === "PARSING"
                ? "дождитесь завершения обработки"
                : "изменения сейчас недоступны"}
          .
        </p>
      ) : null}
      {registry.documents.length ? (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <IdentificationSelect
                label="Документ"
                value={document?.document_id ?? ""}
                options={registry.documents.map((item) => ({
                  id: item.document_id,
                  label: reviewDocumentName(item, filenames),
                }))}
                onChange={(id) => navigate(id)}
              />
            </div>
            {(document?.revisions.length ?? 0) > 1 ? (
              <div className="flex gap-2" aria-label="Редакции документа">
                {document!.revisions.map((item, index) => (
                  <Button
                    key={item.revision_id}
                    size="sm"
                    variant={
                      item.revision_id === revision?.revision_id
                        ? "secondary"
                        : "outline"
                    }
                    onPress={() =>
                      navigate(document!.document_id, item.revision_id)
                    }
                  >
                    Редакция {item.fields.revision_label ?? index + 1}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
          {document && revision ? (
            <DocumentReview
              key={`${document.document_id}:${revision.revision_id}:${refresh}`}
              objectId={objectId}
              registry={registry}
              document={document}
              revision={revision}
              filenames={filenames}
              unavailable={unavailable}
              onReload={async () => {
                if (await onReload()) setRefresh((value) => value + 1);
              }}
              onApplied={(result) => {
                const next = new URLSearchParams(params);
                next.set("processId", registry.process_id);
                next.set("runId", result.run_id);
                next.set("documentId", document.document_id);
                next.set("revisionId", revision.revision_id);
                if (result.resolved_input_hash)
                  next.set("resolvedInputHash", result.resolved_input_hash);
                else next.delete("resolvedInputHash");
                onParams(next, { replace: true });
              }}
            />
          ) : (
            <p role="alert">
              {document
                ? "Редакция отсутствует в этом расчёте. Выберите другую редакцию."
                : "Документ отсутствует в этом расчёте. Выберите другой документ."}
            </p>
          )}
        </>
      ) : (
        <p className="text-copy-muted py-5">
          После обработки здесь появятся документы для проверки.
        </p>
      )}
    </div>
  );
}
