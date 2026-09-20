import { Button } from "@heroui/react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";

import { useFiles, useObject } from "@/api/hooks/use-objects";
import { useParsingStatus } from "@/api/hooks/use-parsing";
import { Role } from "@/api/types/auth";
import type { ParsingFile } from "@/api/types/parsing";
import { UploadIcon } from "@/components/UploadIcon";
import routeNames from "@/routes/routeNames";
import { useAuthSessionStore } from "@/store/auth-session";
import { ConstrainedLayout } from "../../layouts/ConstrainedLayout";
import { DocumentUploader } from "./components/DocumentUploader";
import {
  DocumentViewer,
  type DocumentViewState,
} from "./components/DocumentViewer";
import { FilesTable } from "./components/FilesTable";
import { ParsingPanel } from "./components/ParsingPanel";

export function ObjectDetailsPage() {
  const { objectId = "" } = useParams();
  const navigate = useNavigate();
  const canVerifyMetadata = useAuthSessionStore(
    (state) => state.user?.role === Role.INSPECTOR,
  );
  const object = useObject(objectId);
  const [params, setParams] = useSearchParams();
  const requestedPage = Number(params.get("page"));
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1;
  const files = useFiles(objectId, page);
  const visibleFiles = files.isError ? undefined : files.data;
  const data = object.isError ? undefined : object.data;
  const parsing = useParsingStatus(objectId, Boolean(data));
  const parsingData = parsing.isError ? undefined : parsing.data;
  const selectedFileId = params.get("file");
  const selectedFile = parsingData?.items.find(
    (file) => file.file_id === selectedFileId,
  );
  const selectedOriginal = visibleFiles?.items.find(
    (file) => file.id === selectedFileId,
  );
  const requestedDocumentPage = Number(params.get("documentPage"));
  const documentPage =
    Number.isSafeInteger(requestedDocumentPage) && requestedDocumentPage > 0
      ? requestedDocumentPage
      : 1;
  const requestedView = params.get("documentView");
  const viewState: DocumentViewState = {
    view:
      requestedView === "regions" ||
      requestedView === "tables" ||
      requestedView === "document"
        ? requestedView
        : "fragments",
    mode:
      params.get("documentText") === "raw_text"
        ? "raw_text"
        : "normalized_text",
    regionId: params.get("documentRegion"),
    blockId: params.get("documentBlock"),
  };

  function openDocument(file: ParsingFile) {
    setParams((current) => {
      current.set("file", file.file_id);
      current.set("documentPage", "1");
      for (const key of [
        "documentView",
        "documentText",
        "documentRegion",
        "documentBlock",
      ])
        current.delete(key);
      return current;
    });
  }

  function changePage(nextPage: number) {
    setParams((current) => {
      current.set("page", String(nextPage));
      return current;
    });
  }

  return (
    <ConstrainedLayout>
      <header>
        <Link
          className="text-copy-muted hover:text-accent inline-flex items-center gap-2 text-sm"
          to={routeNames.OBJECTS}
        >
          <UploadIcon className="size-4" name="arrow-left" /> Все объекты
        </Link>
        <h1 className="mt-5 text-[clamp(2rem,3.2vw,3.25rem)] leading-[1.08] font-semibold tracking-[-0.045em] break-words">
          {data?.name ?? "Документы объекта"}
        </h1>
        <p className="text-copy-muted mt-3 text-sm leading-6 sm:text-base">
          Оригиналы документов и загрузка новых комплектов.
        </p>
        {data && (
          <p className="text-copy-muted mt-3 text-xs">
            Объект создан{" "}
            {new Date(data.created_at).toLocaleDateString("ru-RU")}
          </p>
        )}
        {data && canVerifyMetadata && (
          <Button
            className="mt-5 rounded-xl"
            onPress={() => {
              void navigate(routeNames.DOCUMENT_VERIFICATION_DETAILS(data.id));
            }}
          >
            <UploadIcon className="size-4.5" name="sparkles" />
            Проверить метаданные
          </Button>
        )}
      </header>
      {object.isPending && (
        <p role="status" className="text-copy-muted py-8">
          Загружаем объект…
        </p>
      )}
      {object.error && (
        <div
          role="alert"
          className="border-border bg-card space-y-3 rounded-[20px] border p-6"
        >
          <p className="text-danger">{object.error.message}</p>
          <Button
            className="rounded-xl"
            variant="outline"
            onPress={() => {
              void object.refetch();
            }}
          >
            Повторить
          </Button>
        </div>
      )}
      {data && (
        <>
          <div className="grid items-start gap-4 xl:grid-cols-3">
            <div className="min-w-0 xl:col-span-2">
              {data.allowed_actions.includes("upload") ? (
                <DocumentUploader key={objectId} objectId={objectId} />
              ) : (
                <section className="border-border bg-card rounded-[20px] border p-6">
                  <h2 className="text-lg font-semibold">Просмотр документов</h2>
                  <p className="text-copy-muted mt-2 text-sm leading-6">
                    Для этого объекта загрузка документов недоступна.
                  </p>
                </section>
              )}
            </div>
            <aside className="space-y-4">
              <section className="bg-accent text-accent-foreground rounded-[25px] p-6 sm:p-7">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-medium">Оригиналов в объекте</h2>
                  <span className="bg-accent-foreground/15 grid size-10 place-items-center rounded-xl">
                    <UploadIcon className="size-5" name="file" />
                  </span>
                </div>
                <strong className="mt-6 block text-6xl leading-none font-normal tracking-[-0.045em]">
                  {visibleFiles?.total ?? "—"}
                </strong>
                <p className="text-accent-foreground/75 mt-4 text-sm leading-6">
                  Файлы, сохранённые для этого объекта.
                </p>
              </section>
              <section className="border-border bg-card rounded-[20px] border p-5">
                <div className="flex items-center gap-2">
                  <UploadIcon className="text-accent size-5" name="info" />
                  <h2 className="font-semibold">После загрузки</h2>
                </div>
                <p className="text-copy-muted mt-3 text-sm leading-6">
                  Сервер проверяет файлы и показывает результат приёма для
                  каждого оригинала. Совпадающие файлы повторно не сохраняются.
                </p>
                <p className="text-copy-muted border-border mt-4 border-t pt-4 text-xs leading-5">
                  Приём файлов не означает завершение анализа или проверку
                  комплектности.
                </p>
              </section>
            </aside>
          </div>
          <ParsingPanel
            objectId={objectId}
            query={parsing}
            onOpen={openDocument}
          />
          {selectedFile?.state === "succeeded" && selectedFile.artifact_id && (
            <DocumentViewer
              key={`${objectId}:${selectedFile.run_id}:${selectedFile.file_id}:${selectedFile.artifact_id}`}
              objectId={objectId}
              file={selectedFile}
              sourceFormat={selectedOriginal?.format}
              sourceHash={selectedOriginal?.sha256}
              pageNumber={documentPage}
              viewState={viewState}
              onNavigate={(next, state) =>
                setParams((current) => {
                  current.set("documentPage", String(next));
                  current.set("documentView", state.view);
                  current.set("documentText", state.mode);
                  if (state.regionId)
                    current.set("documentRegion", state.regionId);
                  else current.delete("documentRegion");
                  if (state.blockId)
                    current.set("documentBlock", state.blockId);
                  else current.delete("documentBlock");
                  return current;
                })
              }
              onPage={(next) =>
                setParams(
                  (current) => {
                    current.set("documentPage", String(next));
                    return current;
                  },
                  { replace: true },
                )
              }
              onClose={() =>
                setParams((current) => {
                  current.delete("file");
                  current.delete("documentPage");
                  for (const key of [
                    "documentView",
                    "documentText",
                    "documentRegion",
                    "documentBlock",
                  ])
                    current.delete(key);
                  return current;
                })
              }
            />
          )}
          {selectedFileId &&
            parsingData &&
            (!selectedFile ||
              selectedFile.state !== "succeeded" ||
              !selectedFile.artifact_id) && (
              <p role="status" className="text-copy-muted text-sm">
                Для выбранного файла пока нет результата текущей обработки.
              </p>
            )}
          <section
            className="border-border bg-card min-w-0 overflow-hidden rounded-[20px] border shadow-sm"
            aria-labelledby="files-title"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-5">
              <div>
                <h2 id="files-title" className="text-lg font-semibold">
                  Сохранённые оригиналы
                </h2>
                <p className="text-copy-muted mt-1 text-xs">
                  Скачивание исходных файлов без изменения содержимого
                </p>
              </div>
              {visibleFiles && (
                <span className="bg-accent/10 text-accent rounded-full px-3 py-1 text-xs font-medium">
                  Всего {visibleFiles.total}
                </span>
              )}
            </div>
            {files.isPending && (
              <p
                role="status"
                className="text-copy-muted p-10 text-center text-sm"
              >
                Загружаем документы…
              </p>
            )}
            {files.error && (
              <div role="alert" className="space-y-3 px-5 pb-5">
                <p className="text-danger text-sm">{files.error.message}</p>
                <Button
                  className="rounded-xl"
                  variant="outline"
                  onPress={() => {
                    void files.refetch();
                  }}
                >
                  Повторить загрузку списка
                </Button>
              </div>
            )}
            {visibleFiles && (
              <FilesTable
                key={objectId}
                files={visibleFiles.items}
                objectId={objectId}
                parsingFiles={parsingData?.items}
                onOpen={openDocument}
              />
            )}
            {visibleFiles && visibleFiles.total > visibleFiles.limit && (
              <div className="border-border flex flex-wrap items-center justify-end gap-3 border-t px-5 py-4">
                <span className="text-copy-muted mr-auto text-sm">
                  Страница {page} из{" "}
                  {Math.ceil(visibleFiles.total / visibleFiles.limit)}
                </span>
                <Button
                  className="rounded-xl"
                  size="sm"
                  variant="outline"
                  isDisabled={page <= 1}
                  onPress={() => changePage(page - 1)}
                >
                  Назад
                </Button>
                <Button
                  className="rounded-xl"
                  size="sm"
                  variant="outline"
                  isDisabled={page * visibleFiles.limit >= visibleFiles.total}
                  onPress={() => changePage(page + 1)}
                >
                  Далее
                </Button>
              </div>
            )}
          </section>
        </>
      )}
    </ConstrainedLayout>
  );
}
