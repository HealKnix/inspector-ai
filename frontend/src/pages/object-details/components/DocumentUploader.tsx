import { Button } from "@heroui/react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/errors";
import { useReceipt, useUploadDocuments } from "@/api/hooks/use-objects";
import type { SelectedFile } from "@/api/types/objects";
import { FileDropzone } from "@/components/file-dropzone/FileDropzone";
import { UploadIcon } from "@/components/UploadIcon";
import { UploadReceiptResult } from "./UploadReceiptResult";

export function DocumentUploader({ objectId }: { objectId: string }) {
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [params, setParams] = useSearchParams();
  const upload = useUploadDocuments();
  const receipt = useReceipt(objectId, params.get("upload"), !upload.isPending);
  const result = receipt.isError ? undefined : receipt.data;
  const total = files.reduce((sum, item) => sum + item.file.size, 0);
  const tooLarge = total > 200_000_000;
  const selectionLocked =
    upload.isPending || Boolean(attemptId) || params.has("upload");

  function submit() {
    const id = attemptId ?? crypto.randomUUID();
    setAttemptId(id);
    setProgress(null);
    setParams((current) => {
      current.set("upload", id);
      return current;
    });
    upload.mutate({ objectId, uploadId: id, files, onProgress: setProgress });
  }

  return (
    <section
      className="border-border bg-card space-y-5 rounded-[20px] border p-4 shadow-sm sm:p-5"
      aria-labelledby="upload-title"
    >
      <div>
        <h2 id="upload-title" className="text-lg font-semibold">
          Добавить документы
        </h2>
        <p className="text-copy-muted mt-1 text-sm leading-6">
          Загрузите новые оригиналы в этот объект. Уже сохранённые файлы будут
          пропущены.
        </p>
      </div>
      <FileDropzone
        errors={[]}
        inputLabel="Выберите файлы"
        isDisabled={selectionLocked}
        onFilesSelected={(selected) => {
          if (selectionLocked) return;
          setFiles((current) => [
            ...current,
            ...selected.map((file) => ({ file, id: crypto.randomUUID() })),
          ]);
        }}
      />
      {!!files.length && (
        <div className="border-border overflow-hidden rounded-xl border">
          <div className="bg-surface-high flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
            <span className="font-medium">Выбрано файлов: {files.length}</span>
            <span className="text-copy-muted">
              {(total / 1_000_000).toLocaleString("ru-RU", {
                maximumFractionDigits: 2,
              })}{" "}
              МБ / 200 МБ
            </span>
          </div>
          <ul className="divide-border max-h-60 divide-y overflow-y-auto px-4">
            {files.map(({ file, id }) => (
              <li className="flex items-center gap-3 py-3 text-sm" key={id}>
                <UploadIcon
                  className="text-copy-muted size-5 shrink-0"
                  name="file"
                />
                <div className="min-w-0 flex-1">
                  <p className="font-medium break-words">{file.name}</p>
                  <p className="text-copy-muted mt-1 text-xs">
                    {(file.size / 1_000_000).toFixed(2)} МБ{" "}
                    {file.size > 50_000_000 && (
                      <span className="text-danger">
                        — превышает лимит файла
                      </span>
                    )}
                  </p>
                </div>
                <Button
                  aria-label={`Убрать файл ${file.name}`}
                  className="shrink-0 rounded-lg"
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  isDisabled={selectionLocked}
                  onPress={() =>
                    setFiles((current) =>
                      current.filter((item) => item.id !== id),
                    )
                  }
                >
                  <UploadIcon className="size-4" name="trash" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {tooLarge && (
        <p
          role="alert"
          className="bg-danger/10 text-danger rounded-xl p-3 text-sm"
        >
          Пакет превышает 200 МБ. Уменьшите объём файлов.
        </p>
      )}
      {upload.isPending && (
        <p
          role="status"
          className="bg-accent/5 text-accent rounded-xl p-3 text-sm"
        >
          {progress === null
            ? "Подготавливаем передачу…"
            : progress < 100
              ? "Передано: " + progress + "%"
              : "Файлы переданы. Сервер проверяет и сохраняет документы…"}
        </p>
      )}
      {upload.error && (
        <div role="alert" className="bg-danger/10 rounded-xl p-3 text-sm">
          <p className="text-danger">{upload.error.message}</p>
          <p className="text-copy-muted mt-2 leading-6">
            При потере ответа сначала проверьте приём. Повтор отправки
            использует тот же ключ.
          </p>
        </div>
      )}
      {params.has("upload") && !result && !upload.isPending && (
        <div className="bg-surface-high space-y-3 rounded-xl p-4 text-sm">
          <p>
            {receipt.error instanceof ApiError && receipt.error.status === 404
              ? "Подтверждение приёма пока не найдено."
              : (receipt.error?.message ?? "Проверяем приём…")}
          </p>
          <Button
            className="rounded-xl"
            variant="outline"
            onPress={() => {
              void receipt.refetch();
            }}
          >
            Проверить приём
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          className="rounded-xl"
          isPending={upload.isPending}
          isDisabled={!files.length || tooLarge || Boolean(result)}
          onPress={submit}
        >
          <UploadIcon className="size-4.5" name="upload" />
          {attemptId ? "Повторить отправку" : "Загрузить документы"}
        </Button>
        {(attemptId || params.has("upload")) && !upload.isPending && (
          <Button
            className="rounded-xl"
            variant="outline"
            onPress={() => {
              setAttemptId(null);
              setFiles([]);
              upload.reset();
              setParams((current) => {
                current.delete("upload");
                return current;
              });
            }}
          >
            Новый пакет
          </Button>
        )}
      </div>
      {result && (
        <UploadReceiptResult
          key={result.client_upload_id}
          objectId={objectId}
          result={result}
        />
      )}
    </section>
  );
}
