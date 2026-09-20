import { Button } from "@heroui/react";
import { useState } from "react";

import { downloadOriginal } from "@/api/endpoints/objects";
import type { UploadResponse } from "@/api/types/objects";
import { UploadIcon } from "@/components/UploadIcon";

export function UploadReceiptResult({
  objectId,
  result,
}: {
  objectId: string;
  result: UploadResponse;
}) {
  const [downloadError, setDownloadError] = useState<string | null>(null);
  return (
    <div className="border-border border-t pt-5">
      <h3 className="font-semibold">Результат приёма</h3>
      <ul className="divide-border mt-3 divide-y">
        {result.files.map((file) => (
          <li key={file.client_file_id} className="py-3 text-sm break-words">
            <span className="font-medium">{file.original_name}</span>
            <p
              className={`mt-1 ${file.accepted ? "text-success" : file.error === "duplicate_file" ? "text-copy-muted" : "text-danger"}`}
            >
              {file.accepted ? "Оригинал принят" : file.message}
            </p>
            {!file.accepted && file.existing_file_id && (
              <Button
                className="mt-2 rounded-xl"
                size="sm"
                variant="outline"
                onPress={() => {
                  setDownloadError(null);
                  void downloadOriginal(
                    objectId,
                    file.existing_file_id!,
                    file.original_name,
                  ).catch((error: unknown) =>
                    setDownloadError(
                      error instanceof Error
                        ? error.message
                        : "Не удалось скачать оригинал",
                    ),
                  );
                }}
              >
                <UploadIcon className="size-4" name="download" />
                Скачать загруженный файл
              </Button>
            )}
          </li>
        ))}
      </ul>
      {downloadError && (
        <p role="alert" className="text-danger mt-3 text-sm">
          {downloadError}
        </p>
      )}
      <p className="bg-surface-high text-copy-muted mt-4 rounded-xl p-3 text-sm leading-6">
        {result.process_id
          ? "Задание обработки зарегистрировано. Результаты анализа появятся после его выполнения."
          : result.files.every(
                (file) => !file.accepted && file.error === "duplicate_file",
              )
            ? "Все файлы уже загружены. Повторная обработка не запущена."
            : "Новых файлов не принято. Проверка не создана."}
      </p>
    </div>
  );
}
