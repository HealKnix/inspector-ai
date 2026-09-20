import { Button } from "@heroui/react";
import { useSearchParams } from "react-router-dom";

import { useObject } from "@/api/hooks/use-objects";
import { parsingErrorMessage, useParsingStatus } from "@/api/hooks/use-parsing";
import type { ParsingFile } from "@/api/types/parsing";
import { UploadIcon } from "@/components/UploadIcon";
import { ConstrainedLayout, PageHeader } from "@/layouts/ConstrainedLayout";
import routeNames from "@/routes/routeNames";

import { ParsedDocumentPane } from "./ParsedDocumentPane";

const parsingStatePresentation: Record<
  ParsingFile["state"],
  { label: string; className: string; dotClassName: string }
> = {
  queued: {
    label: "В очереди",
    className: "bg-default/60 text-foreground",
    dotClassName: "bg-copy-muted",
  },
  processing: {
    label: "Обрабатывается",
    className: "bg-warning/10 text-foreground",
    dotClassName: "bg-warning",
  },
  succeeded: {
    label: "Готово к просмотру",
    className: "bg-success/10 text-foreground",
    dotClassName: "bg-success",
  },
  failed: {
    label: "Ошибка обработки",
    className: "bg-danger/10 text-foreground",
    dotClassName: "bg-danger",
  },
};

function positivePage(value: string | null) {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function LoadingState({ children }: { children: string }) {
  return (
    <div className="text-copy-muted grid min-h-72 place-items-center p-6 text-sm">
      <p role="status">{children}</p>
    </div>
  );
}

function QueryError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="mx-auto grid min-h-72 max-w-xl place-items-center p-6">
      <div
        className="border-border bg-card w-full space-y-4 rounded-[20px] border p-6"
        role="alert"
      >
        <p className="text-danger text-sm">{message}</p>
        <Button onPress={onRetry} variant="outline">
          Повторить
        </Button>
      </div>
    </div>
  );
}

function PackageDocumentsPanel({ files }: { files: readonly ParsingFile[] }) {
  const readyCount = files.filter(
    (file) => file.state === "succeeded" && file.artifact_id,
  ).length;

  return (
    <aside className="border-line bg-card flex h-[680px] min-w-0 flex-col overflow-hidden rounded-2xl border">
      <div className="border-line border-b p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Документы комплекта</h2>
          <span className="bg-accent/10 text-accent rounded-full px-2.5 py-1 text-xs font-semibold">
            {files.length}
          </span>
        </div>
        <p className="text-copy-muted mt-2 text-xs leading-5">
          К предпросмотру готовы {readyCount} из {files.length}. Состояния
          относятся к обработке файлов, а не к проверке метаданных.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <ul className="space-y-2">
          {files.map((file) => {
            const presentation = parsingStatePresentation[file.state];

            return (
              <li
                className="border-line bg-surface-low rounded-xl border p-3"
                key={`${file.file_id}:${file.run_id}`}
              >
                <p className="truncate text-sm font-medium">
                  {file.original_name}
                </p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${presentation.className}`}
                  >
                    <span
                      aria-hidden="true"
                      className={`size-1.5 rounded-full ${presentation.dotClassName}`}
                    />
                    {presentation.label}
                  </span>
                  <span className="text-copy-muted text-[11px] tabular-nums">
                    {file.pages_total === null
                      ? `${file.pages_completed} стр. обработано`
                      : `${file.pages_completed} / ${file.pages_total} стр.`}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </aside>
  );
}

export function ObjectVerificationWorkspace({
  objectId,
}: {
  objectId: string;
}) {
  const objectQuery = useObject(objectId);
  const object = objectQuery.isError ? undefined : objectQuery.data;
  const parsingQuery = useParsingStatus(objectId, Boolean(object));
  const parsing = parsingQuery.isError ? undefined : parsingQuery.data;
  const [searchParams, setSearchParams] = useSearchParams();

  if (objectQuery.isPending) {
    return <LoadingState>Загружаем объект проверки…</LoadingState>;
  }

  if (objectQuery.error) {
    return (
      <QueryError
        message={objectQuery.error.message}
        onRetry={() => {
          void objectQuery.refetch();
        }}
      />
    );
  }

  if (!object) {
    return <LoadingState>Объект проверки недоступен.</LoadingState>;
  }

  if (parsingQuery.isPending) {
    return <LoadingState>Загружаем документы комплекта…</LoadingState>;
  }

  if (parsingQuery.error) {
    return (
      <QueryError
        message={parsingErrorMessage(parsingQuery.error)}
        onRetry={() => {
          void parsingQuery.refetch();
        }}
      />
    );
  }

  const files = parsing?.items ?? [];
  const readyFiles = files.filter(
    (file): file is ParsingFile & { artifact_id: string } =>
      file.state === "succeeded" && Boolean(file.artifact_id),
  );
  const leftFile =
    readyFiles.find((file) => file.file_id === searchParams.get("leftFile")) ??
    readyFiles[0];
  const rightFile =
    readyFiles.find((file) => file.file_id === searchParams.get("rightFile")) ??
    readyFiles[1];

  const updateSearchParam = (name: string, value: string) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set(name, value);
        return next;
      },
      { replace: true },
    );
  };

  const selectFile = (slot: "left" | "right", fileId: string) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set(`${slot}File`, fileId);
        next.delete(`${slot}Page`);
        return next;
      },
      { replace: true },
    );
  };

  return (
    <ConstrainedLayout>
      <PageHeader
        backHref={routeNames.OBJECT_UPLOAD(objectId)}
        backLabel="Вернуться к объекту"
        breadcrumbs={["Проверки", object.name, "Метаданные и страницы"]}
        badge="Инспектор"
        notice={
          <>
            Показаны фактические страницы текущих результатов обработки объекта
            «{object.name}».
          </>
        }
        noticeLabel="ДАННЫЕ ОБЪЕКТА"
        title="Проверка комплекта документов"
      />

      {files.length === 0 ? (
        <section className="border-line bg-card text-copy-muted mt-5 grid min-h-72 place-items-center rounded-2xl border p-6 text-center text-sm">
          В объекте пока нет документов, зарегистрированных для обработки.
        </section>
      ) : readyFiles.length === 0 ? (
        <div className="mt-5 grid gap-4 min-[1100px]:grid-cols-12">
          <section className="border-line bg-card text-copy-muted grid min-h-72 place-items-center rounded-2xl border p-6 text-center text-sm min-[1100px]:col-span-8">
            Страницы появятся после успешного завершения обработки хотя бы
            одного документа.
          </section>
          <div className="min-[1100px]:col-span-4">
            <PackageDocumentsPanel files={files} />
          </div>
        </div>
      ) : (
        <div className="mt-5 grid items-stretch gap-4 min-[1440px]:grid-cols-12">
          <div
            className={`grid min-w-0 gap-4 min-[1440px]:col-span-8 ${rightFile ? "min-[840px]:grid-cols-2" : "grid-cols-1"}`}
          >
            {leftFile && (
              <ParsedDocumentPane
                className="h-[680px]"
                file={leftFile}
                files={readyFiles}
                key={`left:${leftFile.file_id}:${leftFile.run_id}:${leftFile.artifact_id}`}
                label="Документ 1"
                objectId={objectId}
                onFileChange={(fileId) => selectFile("left", fileId)}
                onPageChange={(page) =>
                  updateSearchParam("leftPage", String(page))
                }
                pageNumber={positivePage(searchParams.get("leftPage"))}
              />
            )}
            {rightFile && (
              <ParsedDocumentPane
                className="h-[680px]"
                file={rightFile}
                files={readyFiles}
                key={`right:${rightFile.file_id}:${rightFile.run_id}:${rightFile.artifact_id}`}
                label="Документ 2"
                objectId={objectId}
                onFileChange={(fileId) => selectFile("right", fileId)}
                onPageChange={(page) =>
                  updateSearchParam("rightPage", String(page))
                }
                pageNumber={positivePage(searchParams.get("rightPage"))}
              />
            )}
          </div>
          <div className="min-w-0 min-[1440px]:col-span-4">
            <PackageDocumentsPanel files={files} />
          </div>
        </div>
      )}

      <section className="border-line bg-card mt-4 rounded-2xl border p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="bg-warning/10 text-warning grid size-10 shrink-0 place-items-center rounded-xl">
            <UploadIcon className="size-5" name="info" />
          </span>
          <div>
            <h2 className="font-semibold">Проверка метаданных</h2>
            <p className="text-copy-muted mt-2 max-w-4xl text-sm leading-6">
              Текущий API возвращает страницы и техническое состояние обработки,
              но ещё не предоставляет распознанные стадию ПД/РД/ИД, шифр,
              редакцию, утверждение и решения по спорным полям. Поэтому эта
              страница не подменяет отсутствующий результат проверки
              вымышленными значениями и пока работает как фактический
              предпросмотр комплекта.
            </p>
          </div>
        </div>
      </section>
    </ConstrainedLayout>
  );
}
