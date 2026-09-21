import { Button, Table } from "@heroui/react";
import { useState } from "react";

import { downloadOriginal } from "@/api/endpoints/objects";
import type { ObjectFile } from "@/api/types/objects";
import type { ParsingFile } from "@/api/types/parsing";
import { UploadIcon, type UploadIconName } from "@/components/UploadIcon";

const formatIcons: Record<ObjectFile["format"], UploadIconName> = {
  PDF: "pdf",
  DOCX: "docx",
  XML: "xml",
};

export function FilesTable({
  files,
  objectId,
  parsingFiles,
  onOpen,
}: {
  files: ObjectFile[];
  objectId: string;
  parsingFiles?: ParsingFile[];
  onOpen?: (file: ParsingFile) => void;
}) {
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  async function download(file: ObjectFile) {
    setDownloadError(null);
    setDownloading(file.id);
    try {
      await downloadOriginal(objectId, file.id, file.original_name);
    } catch (error) {
      setDownloadError(
        error instanceof Error ? error.message : "Не удалось скачать оригинал",
      );
    } finally {
      setDownloading(null);
    }
  }

  return (
    <>
      {downloadError && (
        <p
          role="alert"
          className="bg-danger/10 text-danger mx-5 mb-4 rounded-xl p-3 text-sm"
        >
          {downloadError}
        </p>
      )}
      <Table className="rounded-none border-0 shadow-none">
        <Table.ScrollContainer>
          <Table.Content
            aria-label="Сохранённые оригиналы"
            className="min-w-[720px]"
          >
            <Table.Header>
              <Table.Column isRowHeader>Файл</Table.Column>
              <Table.Column>Формат</Table.Column>
              <Table.Column>Размер</Table.Column>
              <Table.Column>Загружен</Table.Column>
              <Table.Column aria-label="Скачать оригинал" />
            </Table.Header>
            <Table.Body
              renderEmptyState={() => (
                <div className="text-copy-muted flex min-h-48 flex-col items-center justify-center gap-3 px-5 text-center text-sm">
                  <UploadIcon className="size-9" name="file" />
                  <p>Документов пока нет.</p>
                </div>
              )}
            >
              {files.map((file) => (
                <Table.Row key={file.id}>
                  <Table.Cell>
                    <div className="flex items-center gap-3 py-2">
                      <span className="bg-surface-high grid size-10 shrink-0 place-items-center rounded-xl">
                        <UploadIcon
                          className="size-6"
                          name={formatIcons[file.format]}
                        />
                      </span>
                      <div className="max-w-md min-w-0">
                        <p className="font-medium break-words">
                          {file.original_name}
                        </p>
                        {file.integrity_error && (
                          <p className="text-danger mt-1 text-xs">
                            Нарушена целостность оригинала
                          </p>
                        )}
                      </div>
                    </div>
                  </Table.Cell>
                  <Table.Cell>
                    <span className="bg-surface-high text-copy-muted rounded-full px-2.5 py-1 text-xs font-medium">
                      {file.format}
                    </span>
                  </Table.Cell>
                  <Table.Cell className="text-copy-muted whitespace-nowrap">
                    {(file.size / 1_000_000).toLocaleString("ru-RU", {
                      maximumFractionDigits: 2,
                    })}{" "}
                    МБ
                  </Table.Cell>
                  <Table.Cell className="text-copy-muted whitespace-nowrap">
                    {new Date(file.created_at).toLocaleDateString("ru-RU")}
                  </Table.Cell>
                  <Table.Cell>
                    {(() => {
                      const parsed = parsingFiles?.find(
                        (item) =>
                          item.file_id === file.id &&
                          item.state === "succeeded" &&
                          item.artifact_id,
                      );
                      return parsed && onOpen ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="rounded-xl"
                          aria-label={`Просмотреть документ: ${file.original_name}`}
                          onPress={() => onOpen(parsed)}
                        >
                          Просмотреть
                        </Button>
                      ) : null;
                    })()}
                    <Button
                      aria-label={`Скачать оригинал: ${file.original_name}`}
                      className="rounded-xl"
                      size="sm"
                      variant="ghost"
                      isDisabled={file.integrity_error || downloading !== null}
                      isPending={downloading === file.id}
                      onPress={() => {
                        void download(file);
                      }}
                    >
                      <UploadIcon className="size-4" name="download" /> Скачать
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </>
  );
}
