import { Button } from "@heroui/react";
import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { downloadOriginal } from "@/api/endpoints/objects";
import {
  useClassificationStatus,
  useRetryClassification,
} from "@/api/hooks/use-classification";
import { useIdentification } from "@/api/hooks/use-identification";
import {
  useFiles,
  useObject,
  useReceipt,
  useUploadDocuments,
} from "@/api/hooks/use-objects";
import { useParsingStatus, useRetryParsing } from "@/api/hooks/use-parsing";
import type { ClassificationFile } from "@/api/types/classification";
import type { ParsingFile } from "@/api/types/parsing";
import {
  loadDeclaredStages,
  saveDeclaredStages,
} from "@/pages/document-upload/lib/declared-stages";
import {
  createPendingUploadFile,
  filterUploadRows,
  getUploadSummary,
  localUploadRow,
  remoteUploadRow,
  validateUploadFiles,
} from "@/pages/document-upload/lib/document-upload";
import {
  DocumentStage,
  UploadDocumentFilter,
  UploadRetryKind,
  type PendingUploadFile,
  type UploadRow,
} from "@/pages/document-upload/types";

import { FileDropzone } from "@/components/file-dropzone/FileDropzone";
import { UploadIcon } from "@/components/UploadIcon";
import { ConstrainedLayout } from "@/layouts/ConstrainedLayout";
import routeNames from "@/routes/routeNames";
import { CheckDocumentsAction } from "./components/CheckDocumentsAction";
import { CompletenessPanel } from "./components/CompletenessPanel";
import { DocumentsTable } from "./components/DocumentsTable";
import { MetadataAssistant } from "./components/MetadataAssistant";
import { PackageStagePicker } from "./components/PackageStagePicker";
import { UploadHeader } from "./components/UploadHeader";
import { UploadReceiptResult } from "./components/UploadReceiptResult";
import { UploadSummary } from "./components/UploadSummary";

const FILES_LIMIT = 100;

export function DocumentUploadPage() {
  const { objectId = "" } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const objectQuery = useObject(objectId);
  const object = objectQuery.isError ? undefined : objectQuery.data;
  const canUpload = object?.allowed_actions.includes("upload") ?? false;

  const filesQuery = useFiles(objectId, 1, FILES_LIMIT);
  const remoteFiles = filesQuery.isError ? undefined : filesQuery.data;
  const parsingQuery = useParsingStatus(objectId, Boolean(object));
  const parsing = parsingQuery.isError ? undefined : parsingQuery.data;
  const processId = parsing?.items[0]?.process_id ?? "";
  const identificationQuery = useIdentification(objectId, processId);
  const registry = identificationQuery.isError
    ? undefined
    : identificationQuery.data;
  const classificationQuery = useClassificationStatus(
    objectId,
    parsing
      ? { ...parsing, active: parsing.active || Boolean(registry?.active) }
      : undefined,
    Boolean(object) && !parsingQuery.isError,
    registry?.resolved_input_hash,
  );
  const classification = classificationQuery.isError
    ? undefined
    : classificationQuery.data;

  const [packageStage, setPackageStage] = useState<DocumentStage>(
    DocumentStage.PD,
  );
  const [pendingFiles, setPendingFiles] = useState<PendingUploadFile[]>([]);
  const [declaredStages, setDeclaredStages] = useState<
    Record<string, DocumentStage>
  >(() => loadDeclaredStages(objectId));
  const [filter, setFilter] = useState<UploadDocumentFilter>(
    UploadDocumentFilter.ALL,
  );
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const upload = useUploadDocuments();
  const receipt = useReceipt(
    objectId,
    searchParams.get("upload"),
    !upload.isPending,
  );
  const receiptResult = receipt.isError ? undefined : receipt.data;
  const retryParsing = useRetryParsing();
  const retryClassification = useRetryClassification();

  const parsingByFileId = useMemo(
    () =>
      new Map<string, ParsingFile>(
        parsing?.items.map((item) => [item.file_id, item]),
      ),
    [parsing],
  );
  const classificationByFileId = useMemo(
    () =>
      new Map<string, ClassificationFile>(
        classification?.items.map((item) => [item.file_id, item]),
      ),
    [classification],
  );

  const remoteFileIds = useMemo(
    () => new Set(remoteFiles?.items.map((file) => file.id)),
    [remoteFiles],
  );

  const visiblePendingFiles = useMemo(
    () =>
      pendingFiles.filter(
        (pending) =>
          !pending.acceptedFileId || !remoteFileIds.has(pending.acceptedFileId),
      ),
    [pendingFiles, remoteFileIds],
  );

  const rows = useMemo<UploadRow[]>(
    () => [
      ...visiblePendingFiles.map((pending) =>
        localUploadRow(pending, upload.isPending),
      ),
      ...(remoteFiles?.items ?? []).map((file) =>
        remoteUploadRow(
          file,
          parsingByFileId.get(file.id),
          classification?.review_active
            ? undefined
            : classificationByFileId.get(file.id),
          declaredStages[file.id] ?? null,
        ),
      ),
    ],
    [
      visiblePendingFiles,
      remoteFiles,
      parsingByFileId,
      classificationByFileId,
      classification?.review_active,
      declaredStages,
      upload.isPending,
    ],
  );

  const summary = useMemo(() => getUploadSummary(rows), [rows]);
  const visibleRows = useMemo(
    () => filterUploadRows(rows, { filter, query }),
    [rows, filter, query],
  );
  const mismatchCount = useMemo(
    () => rows.filter((row) => row.stageMismatch).length,
    [rows],
  );

  const pendingSizeBytes = pendingFiles.reduce(
    (total, pending) =>
      pending.acceptedFileId ? total : total + pending.file.size,
    0,
  );
  const sendablePendingFiles = pendingFiles.filter(
    (pending) => !pending.acceptedFileId,
  );

  const handleFilesSelected = (files: readonly File[]) => {
    if (files.length === 0 || !canUpload) return;

    const validation = validateUploadFiles(pendingSizeBytes, files);
    setValidationErrors(validation.errors.map((error) => error.message));

    if (validation.acceptedFiles.length === 0) return;

    // A changed package must not reuse the previous upload key.
    setAttemptId(null);
    setPendingFiles((current) => [
      ...current,
      ...validation.acceptedFiles.map((file) =>
        createPendingUploadFile(file, packageStage),
      ),
    ]);
  };

  const submit = () => {
    if (!sendablePendingFiles.length || !canUpload) return;

    const id = attemptId ?? crypto.randomUUID();
    setAttemptId(id);
    setProgress(null);
    setSearchParams((current) => {
      current.set("upload", id);
      return current;
    });
    upload.mutate(
      {
        objectId,
        uploadId: id,
        files: sendablePendingFiles.map((pending) => ({
          id: pending.clientFileId,
          file: pending.file,
        })),
        onProgress: setProgress,
      },
      {
        onSuccess: (response) => {
          const acceptedStages: Record<string, DocumentStage> = {};
          setPendingFiles((current) =>
            current.map((pending) => {
              const outcome = response.files.find(
                (file) => file.client_file_id === pending.clientFileId,
              );
              if (!outcome) return pending;
              if (outcome.accepted) {
                acceptedStages[outcome.file_id] = pending.declaredStage;
                return {
                  ...pending,
                  acceptedFileId: outcome.file_id,
                  outcome: null,
                };
              }
              return {
                ...pending,
                outcome: {
                  duplicate: outcome.error === "duplicate_file",
                  message: outcome.message,
                  existingFileId: outcome.existing_file_id ?? null,
                },
              };
            }),
          );
          if (Object.keys(acceptedStages).length > 0) {
            setDeclaredStages(saveDeclaredStages(objectId, acceptedStages));
          }
        },
      },
    );
  };

  const handleRemovePending = (clientFileId: string) => {
    setAttemptId(null);
    setPendingFiles((current) =>
      current.filter((pending) => pending.clientFileId !== clientFileId),
    );
    setSelectedIds((current) => {
      const next = new Set(current);
      next.delete(clientFileId);
      return next;
    });
  };

  const handleClearPending = () => {
    setAttemptId(null);
    setPendingFiles([]);
    setSelectedIds(new Set());
    setValidationErrors([]);
  };

  const handleRemoveSelected = () => {
    setAttemptId(null);
    setPendingFiles((current) =>
      current.filter((pending) => !selectedIds.has(pending.clientFileId)),
    );
    setSelectedIds(new Set());
  };

  const handleChangeDeclaredStage = (
    clientFileId: string,
    stage: DocumentStage,
  ) => {
    setPendingFiles((current) =>
      current.map((pending) =>
        pending.clientFileId === clientFileId
          ? { ...pending, declaredStage: stage }
          : pending,
      ),
    );
  };

  const handleAcceptDetectedStage = (fileId: string, stage: DocumentStage) => {
    setDeclaredStages(saveDeclaredStages(objectId, { [fileId]: stage }));
  };

  const handleDownload = (row: UploadRow) => {
    const fileId = row.existingFileId ?? row.fileId;
    if (!fileId) return;
    void downloadOriginal(objectId, fileId, row.name);
  };

  const handleRetry = (row: UploadRow) => {
    if (!row.fileId || !row.retryKind) return;
    const requestId = crypto.randomUUID();
    if (row.retryKind === UploadRetryKind.PARSING) {
      retryParsing.mutate({ objectId, fileId: row.fileId, requestId });
    } else {
      retryClassification.mutate({ objectId, fileId: row.fileId, requestId });
    }
  };

  const openIdentification = (row?: UploadRow) => {
    const file =
      (row?.fileId ? parsingByFileId.get(row.fileId) : undefined) ??
      parsing?.items[0];
    if (!file) return;
    void navigate(
      routeNames.OBJECT_DOCUMENTS(objectId, {
        processId: file.process_id,
        runId: file.run_id,
        fileId: row?.fileId ?? undefined,
      }),
    );
  };

  if (objectQuery.isPending) {
    return (
      <ConstrainedLayout>
        <p role="status" className="text-copy-muted py-8">
          Загружаем объект…
        </p>
      </ConstrainedLayout>
    );
  }

  if (objectQuery.error || !object) {
    return (
      <ConstrainedLayout>
        <div
          role="alert"
          className="border-border bg-card space-y-3 rounded-[20px] border p-6"
        >
          <p className="text-danger">
            {objectQuery.error?.message ?? "Объект недоступен"}
          </p>
          <Button
            className="rounded-xl"
            variant="outline"
            onPress={() => {
              void objectQuery.refetch();
            }}
          >
            Повторить
          </Button>
        </div>
      </ConstrainedLayout>
    );
  }

  return (
    <ConstrainedLayout>
      <div className="pb-12">
        <UploadHeader backHref={routeNames.OBJECTS} objectName={object.name} />

        <div className="mt-5 grid items-start gap-4 min-[1100px]:grid-cols-12">
          <div className="grid gap-4 min-[760px]:grid-cols-12 min-[1100px]:col-span-8">
            <div className="min-[760px]:col-span-12">
              <PackageStagePicker
                isDisabled={!canUpload || upload.isPending}
                onChange={setPackageStage}
                value={packageStage}
              />
            </div>
            <div className="min-[760px]:col-span-7">
              <FileDropzone
                errors={validationErrors}
                isDisabled={!canUpload || upload.isPending}
                onFilesSelected={handleFilesSelected}
              />
            </div>
            <div className="min-[760px]:col-span-5">
              <UploadSummary
                needsReviewCount={summary.needsReviewCount}
                readyCount={summary.readyCount}
                stageCounts={summary.stageCounts}
                totalFiles={summary.totalFiles}
                totalKnownPages={summary.totalKnownPages}
                unclassifiedCount={summary.unclassifiedCount}
              />
            </div>
            {!canUpload && (
              <div
                className="border-border bg-card text-copy-muted rounded-[20px] border p-4 text-sm min-[760px]:col-span-12"
                role="note"
              >
                Для этого объекта загрузка документов недоступна.
              </div>
            )}
            {upload.isPending && (
              <p
                role="status"
                className="bg-accent/5 text-accent rounded-xl p-3 text-sm min-[760px]:col-span-12"
              >
                {progress === null
                  ? "Подготавливаем передачу…"
                  : progress < 100
                    ? "Передано: " + progress + "%"
                    : "Файлы переданы. Сервер проверяет и сохраняет документы…"}
              </p>
            )}
            {upload.error && (
              <div
                role="alert"
                className="bg-danger/10 rounded-xl p-3 text-sm min-[760px]:col-span-12"
              >
                <p className="text-danger">{upload.error.message}</p>
                <p className="text-copy-muted mt-2 leading-6">
                  При потере ответа сначала проверьте приём. Повтор отправки
                  использует тот же ключ.
                </p>
              </div>
            )}
            {receiptResult && (
              <div className="border-border bg-card rounded-[20px] border p-5 min-[760px]:col-span-12">
                <UploadReceiptResult
                  key={receiptResult.client_upload_id}
                  objectId={objectId}
                  result={receiptResult}
                />
              </div>
            )}
          </div>

          <div className="min-[1100px]:col-span-4">
            <CompletenessPanel
              objectId={objectId}
              registry={registry}
              canEdit={canUpload}
            />
          </div>

          <div className="min-w-0 min-[1100px]:col-span-8">
            {parsingQuery.isError ||
            classificationQuery.isError ||
            identificationQuery.isError ? (
              <div
                role="alert"
                className="bg-danger/10 mb-3 rounded-xl p-4 text-sm"
              >
                <p>Не удалось обновить состояние документов.</p>
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  onPress={() => {
                    if (parsingQuery.isError) void parsingQuery.refetch();
                    if (classificationQuery.isError)
                      void classificationQuery.refetch();
                    if (identificationQuery.isError)
                      void identificationQuery.refetch();
                  }}
                >
                  Повторить
                </Button>
              </div>
            ) : null}
            {mismatchCount > 0 && (
              <div
                role="alert"
                className="bg-warning/10 text-foreground mb-3 flex items-center gap-3 rounded-[14px] px-4 py-3 text-sm"
              >
                <UploadIcon
                  className="text-warning size-5 shrink-0"
                  name="warning"
                />
                {mismatchCount === 1
                  ? "У 1 файла распознанная стадия отличается от заявленной. Проверьте, что документ загружен в нужный раздел."
                  : `У ${mismatchCount} файлов распознанная стадия отличается от заявленной. Проверьте, что документы загружены в нужный раздел.`}
              </div>
            )}
            <DocumentsTable
              failedCount={summary.failedCount}
              filter={filter}
              needsReviewCount={summary.needsReviewCount}
              onAcceptDetectedStage={handleAcceptDetectedStage}
              onChangeDeclaredStage={handleChangeDeclaredStage}
              onDownload={handleDownload}
              onFilterChange={setFilter}
              onQueryChange={setQuery}
              onRemovePending={handleRemovePending}
              onIdentify={openIdentification}
              onRetry={handleRetry}
              onSelectedIdsChange={setSelectedIds}
              query={query}
              rows={visibleRows}
              selectedIds={selectedIds}
              stageCounts={summary.stageCounts}
              totalFiles={summary.totalFiles}
            />
            {remoteFiles && remoteFiles.total > remoteFiles.items.length && (
              <p className="text-copy-muted mt-3 text-xs">
                Показаны последние {remoteFiles.items.length} из{" "}
                {remoteFiles.total} файлов объекта.
              </p>
            )}
          </div>

          <div className="min-[1100px]:col-span-4">
            <MetadataAssistant
              needsReviewCount={summary.needsReviewCount}
              onOpen={
                parsing?.items.length
                  ? () =>
                      openIdentification(rows.find((row) => row.needsReview))
                  : undefined
              }
            />
          </div>
        </div>
      </div>

      <div className="border-border bg-background/75 absolute inset-x-0 bottom-0 z-20 mt-5 flex min-h-18 items-center gap-3 border-t px-4 py-3 backdrop-blur-md min-[720px]:justify-end min-[1400px]:px-8 sm:px-6">
        <p className="text-copy-muted mr-auto hidden text-sm min-[720px]:block">
          {pendingFiles.length > 0
            ? `В пакете ${pendingFiles.length} файлов · выбрано ${selectedIds.size}`
            : "Проверка всего загруженного комплекта"}
        </p>
        {pendingFiles.length > 0 ? (
          <Button
            aria-label={
              selectedIds.size > 0
                ? "Удалить выбранные файлы"
                : "Очистить список"
            }
            className="rounded-xl"
            isDisabled={pendingFiles.length === 0}
            onPress={
              selectedIds.size > 0 ? handleRemoveSelected : handleClearPending
            }
            variant={selectedIds.size > 0 ? "danger-soft" : "outline"}
          >
            <UploadIcon className="size-4.5" name="trash" />
            <span className="hidden sm:inline">
              {selectedIds.size > 0
                ? `Удалить выбранные (${selectedIds.size})`
                : "Очистить список"}
            </span>
          </Button>
        ) : null}
        {sendablePendingFiles.length > 0 || !processId ? (
          <Button
            className="min-w-0 flex-1 rounded-xl min-[520px]:min-w-52 min-[520px]:flex-none"
            isDisabled={
              sendablePendingFiles.length === 0 ||
              !canUpload ||
              upload.isPending
            }
            isPending={upload.isPending}
            onPress={submit}
          >
            <UploadIcon className="size-4.5" name="upload" />
            {attemptId ? "Повторить отправку" : "Загрузить документы"}
          </Button>
        ) : (
          <CheckDocumentsAction
            objectId={objectId}
            registry={registry}
            preparing={Boolean(
              parsing?.active ||
              classification?.active ||
              classification?.review_active ||
              identificationQuery.isPending,
            )}
            unavailable={
              upload.isPending ||
              parsingQuery.isError ||
              classificationQuery.isError ||
              identificationQuery.isError
            }
          />
        )}
      </div>
    </ConstrainedLayout>
  );
}
