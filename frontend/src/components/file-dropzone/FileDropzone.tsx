import { Button, ScrollShadow } from "@heroui/react";
import { useRef, useState, type ChangeEvent, type DragEvent } from "react";

import { UploadIcon } from "@/components/UploadIcon";
import { cn } from "@/lib/utils";

interface FileDropzoneProps {
  errors: readonly string[];
  onFilesSelected: (files: readonly File[]) => void;
  isDisabled?: boolean;
  inputLabel?: string;
}

const supportedFormats = ".pdf,.docx,.xml";

export function FileDropzone({
  errors,
  onFilesSelected,
  isDisabled = false,
  inputLabel = "Выбор файлов для загрузки",
}: FileDropzoneProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (isDisabled) return;
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    onFilesSelected(files);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (isDisabled) return;
    onFilesSelected(Array.from(event.dataTransfer.files));
  };

  return (
    <section
      className={cn(
        "border-accent/50 bg-accent/2.5 dark:bg-accent/5 h-full rounded-[20px] border border-dashed shadow-sm transition-colors",
        isDragging &&
          !isDisabled &&
          "border-accent dark:bg-accent/10 bg-accent/5",
      )}
    >
      <input
        accept={supportedFormats}
        aria-label={inputLabel}
        disabled={isDisabled}
        className="hidden"
        multiple
        onChange={handleInputChange}
        ref={fileInputRef}
        tabIndex={-1}
        type="file"
      />
      <input
        accept={supportedFormats}
        aria-label="Выбор папки для загрузки"
        disabled={isDisabled}
        className="hidden"
        multiple
        onChange={handleInputChange}
        ref={(element) => {
          folderInputRef.current = element;
          element?.setAttribute("webkitdirectory", "");
          element?.setAttribute("directory", "");
        }}
        tabIndex={-1}
        type="file"
      />

      <div
        className="flex h-full flex-col items-center justify-center px-5 py-9 text-center sm:px-8"
        onDragEnter={(event) => {
          event.preventDefault();
          if (!isDisabled) setIsDragging(true);
        }}
        onDragLeave={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setIsDragging(false);
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDrop={handleDrop}
      >
        <span className="bg-accent/10 text-accent grid size-18 place-items-center rounded-full">
          <UploadIcon className="size-9" name="upload" />
        </span>
        <h2 className="mt-5 text-xl font-semibold tracking-[-0.02em] sm:text-2xl">
          Перетащите файлы сюда
        </h2>
        <p className="text-copy-muted mt-2 max-w-md text-sm leading-6">
          Поддерживаются форматы PDF, DOCX и XML
          <br className="hidden sm:block" /> или выберите файлы на компьютере.
        </p>

        <div className="mt-6 flex w-full max-w-md flex-col gap-2.5 sm:flex-row sm:justify-center">
          <Button
            className="rounded-xl sm:min-w-44"
            isDisabled={isDisabled}
            onPress={() => fileInputRef.current?.click()}
          >
            <UploadIcon className="size-4.5" name="file" />
            Выбрать файлы
          </Button>
          <Button
            className="hover:bg-accent/10 hover:text-accent hover:border-accent/25 rounded-xl transition-all sm:min-w-44"
            onPress={() => folderInputRef.current?.click()}
            isDisabled={isDisabled}
            variant="outline"
          >
            <UploadIcon className="size-4.5" name="folder" />
            Добавить папку
          </Button>
        </div>

        <p className="text-copy-muted mt-6 flex items-center justify-center gap-2 text-xs sm:text-sm">
          <UploadIcon className="size-4" name="info" />
          До 50 МБ на файл · до 200 МБ на пакет
        </p>

        {errors.length > 0 ? (
          <div
            className="bg-destructive/10 text-destructive mt-4 w-full max-w-xl rounded-xl"
            role="alert"
          >
            <ScrollShadow className="max-h-64 px-4 py-3 text-left text-xs leading-5">
              <p className="font-semibold">Не удалось добавить часть файлов</p>
              <ul className="mt-1 list-disc pl-4">
                {errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </ScrollShadow>
          </div>
        ) : null}
      </div>
    </section>
  );
}
