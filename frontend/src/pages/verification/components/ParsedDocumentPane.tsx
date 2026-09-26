import { Button, Label, ListBox, Select } from "@heroui/react";
import { useState } from "react";

import { parsingErrorMessage, useParseResult } from "@/api/hooks/use-parsing";
import type { ParsingFile } from "@/api/types/parsing";
import type { ApiFindingDetail } from "@/api/types/verification";
import { DocumentViewerModal } from "@/components/document-viewer-modal/DocumentViewerModal";
import { RenderedDocumentPage } from "@/components/rendered-document-page/RenderedDocumentPage";
import { UploadIcon } from "@/components/UploadIcon";
import { cn } from "@/lib/utils";

import { evidenceForPage, evidenceRectangle } from "../lib/evidence-navigation";
import { VerificationIcon } from "./VerificationIcon";

interface ParsedDocumentPaneProps {
  className?: string;
  file: ParsingFile;
  files: readonly ParsingFile[];
  label: string;
  /** Блоки доказательств — подсвечиваются на странице. */
  detail?: ApiFindingDetail;
  objectId: string;
  onFileChange: (fileId: string) => void;
  onPageChange: (page: number) => void;
  pageNumber: number;
}

function ToolbarButton({
  ariaLabel,
  icon,
  isDisabled,
  onPress,
}: {
  ariaLabel: string;
  icon: "chevron-left" | "chevron-right" | "fit" | "zoom-in" | "zoom-out";
  isDisabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      aria-label={ariaLabel}
      className="text-copy-muted size-9 min-w-9 rounded-lg p-0"
      isDisabled={isDisabled}
      onPress={onPress}
      size="sm"
      variant="ghost"
    >
      <VerificationIcon className="size-4.5" name={icon} />
    </Button>
  );
}

export function ParsedDocumentPane({
  className,
  file,
  files,
  label,
  detail,
  objectId,
  onFileChange,
  onPageChange,
  pageNumber,
}: ParsedDocumentPaneProps) {
  const query = useParseResult(objectId, file);
  const result = query.isError ? undefined : query.data;
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const page = result?.artifact.pages.find(
    (candidate) => candidate.page_number === pageNumber,
  );
  const evidence = page ? evidenceForPage(detail, file, page.page_number) : [];
  const matchIds = new Set(
    evidence.flatMap((fragment) =>
      fragment.blockId ? [fragment.blockId] : [],
    ),
  );
  const evidenceRects = evidence.flatMap((fragment) => {
    const bbox = evidenceRectangle(fragment.bbox);
    return bbox ? [{ bbox, quote: fragment.quote }] : [];
  });
  const currentPage = page?.page_number ?? 1;
  const totalPages = result?.artifact.pages.length ?? 0;

  const changePage = (nextPage: number) => {
    setSelectedBlockId(null);
    onPageChange(nextPage);
  };

  return (
    <section
      aria-label={`${label}: фактический документ`}
      className={cn(
        "border-line bg-card flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border",
        className,
      )}
    >
      <header className="border-line border-b p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="bg-surface-high text-copy-muted grid size-10 shrink-0 place-items-center rounded-xl">
            <UploadIcon className="size-5" name="file" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-copy-muted text-[11px] font-semibold tracking-[0.08em] uppercase">
              {label}
            </p>
            <h2 className="mt-0.5 truncate text-sm font-semibold sm:text-base">
              {file.original_name}
            </h2>
            <p className="text-copy-muted mt-1 text-xs">
              {detail?.run_id
                ? "Зафиксированный источник находки"
                : `Результат обработки · попытка ${file.attempt}`}
            </p>
          </div>
        </div>

        <Select
          aria-label={`Документ для окна «${label}»`}
          className="mt-4 w-full"
          onChange={(value) => {
            if (typeof value === "string" && value !== file.file_id) {
              setSelectedBlockId(null);
              setZoom("fit");
              onFileChange(value);
            }
          }}
          value={file.file_id}
          variant="secondary"
        >
          <Label className="sr-only">Выберите документ</Label>
          <Select.Trigger className="rounded-xl">
            <Select.Value className="max-w-full truncate" />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover className="not-sm:max-w-0">
            <ListBox>
              {files.map((candidate) => (
                <ListBox.Item
                  id={candidate.file_id}
                  key={`${candidate.file_id}:${candidate.run_id}:${candidate.artifact_id}`}
                  textValue={candidate.original_name}
                  className="data-selected:text-accent data-selected:bg-accent/10 flex gap-2 data-selected:[&>p]:pr-4"
                >
                  <p className="min-w-0 flex-1 truncate">
                    {candidate.original_name}
                  </p>
                  <ListBox.ItemIndicator className="text-accent" />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
      </header>

      <div className="border-line flex min-h-12 flex-wrap items-center gap-1 border-b px-3 py-1.5 sm:px-4">
        <ToolbarButton
          ariaLabel={`Предыдущая страница, ${label}`}
          icon="chevron-left"
          isDisabled={!page || currentPage <= 1}
          onPress={() => changePage(currentPage - 1)}
        />
        <span className="text-copy-muted min-w-20 text-center text-xs tabular-nums">
          <strong className="text-foreground font-semibold">
            {page ? currentPage : "—"}
          </strong>{" "}
          / {totalPages || "—"}
        </span>
        <ToolbarButton
          ariaLabel={`Следующая страница, ${label}`}
          icon="chevron-right"
          isDisabled={!page || currentPage >= totalPages}
          onPress={() => changePage(currentPage + 1)}
        />

        <span aria-hidden="true" className="bg-line mx-1 h-5 w-px" />

        <ToolbarButton
          ariaLabel={`Уменьшить масштаб, ${label}`}
          icon="zoom-out"
          isDisabled={typeof zoom === "number" && zoom <= 0.5}
          onPress={() =>
            setZoom(Math.max(0.5, (zoom === "fit" ? 1 : zoom) - 0.25))
          }
        />
        <span className="text-copy-muted min-w-16 text-center text-xs tabular-nums">
          {zoom === "fit" ? "По ширине" : `${Math.round(zoom * 100)}%`}
        </span>
        <ToolbarButton
          ariaLabel={`Увеличить масштаб, ${label}`}
          icon="zoom-in"
          isDisabled={typeof zoom === "number" && zoom >= 1.5}
          onPress={() =>
            setZoom(Math.min(1.5, (zoom === "fit" ? 1 : zoom) + 0.25))
          }
        />
        <ToolbarButton
          ariaLabel={`Уместить страницу по ширине, ${label}`}
          icon="fit"
          isDisabled={zoom === "fit"}
          onPress={() => setZoom("fit")}
        />

        <div className="ml-auto">
          <DocumentViewerModal
            pageLabel={`Стр. ${currentPage} из ${totalPages}`}
            title={file.original_name}
            toolbar={
              <>
                <div className="flex items-center gap-1">
                  <ToolbarButton
                    ariaLabel="Предыдущая страница в полноэкранном просмотре"
                    icon="chevron-left"
                    isDisabled={currentPage <= 1}
                    onPress={() => changePage(currentPage - 1)}
                  />
                  <span className="text-foreground min-w-16 text-center text-xs tabular-nums">
                    {currentPage} / {totalPages}
                  </span>
                  <ToolbarButton
                    ariaLabel="Следующая страница в полноэкранном просмотре"
                    icon="chevron-right"
                    isDisabled={currentPage >= totalPages}
                    onPress={() => changePage(currentPage + 1)}
                  />
                </div>
                <span
                  aria-hidden="true"
                  className="bg-line hidden h-5 w-px sm:block"
                />
                <div className="flex items-center gap-1">
                  <ToolbarButton
                    ariaLabel="Уменьшить масштаб в полноэкранном просмотре"
                    icon="zoom-out"
                    isDisabled={typeof zoom === "number" && zoom <= 0.5}
                    onPress={() =>
                      setZoom(Math.max(0.5, (zoom === "fit" ? 1 : zoom) - 0.25))
                    }
                  />
                  <span className="text-foreground min-w-12 text-center text-xs tabular-nums">
                    {zoom === "fit"
                      ? "По ширине"
                      : `${Math.round(zoom * 100)}%`}
                  </span>
                  <ToolbarButton
                    ariaLabel="Увеличить масштаб в полноэкранном просмотре"
                    icon="zoom-in"
                    isDisabled={typeof zoom === "number" && zoom >= 1.5}
                    onPress={() =>
                      setZoom(Math.min(1.5, (zoom === "fit" ? 1 : zoom) + 0.25))
                    }
                  />
                  <ToolbarButton
                    ariaLabel="Установить масштаб 100% в полноэкранном просмотре"
                    icon="fit"
                    isDisabled={zoom === "fit"}
                    onPress={() => setZoom("fit")}
                  />
                </div>
              </>
            }
          >
            {query.isPending && (
              <p
                role="status"
                className="text-copy-muted p-8 text-center text-sm"
              >
                Загружаем результат обработки…
              </p>
            )}
            {query.error && (
              <div className="space-y-3 p-6" role="alert">
                <p className="text-danger text-sm">
                  {parsingErrorMessage(query.error)}
                </p>
                <Button
                  onPress={() => {
                    void query.refetch();
                  }}
                  size="sm"
                  variant="outline"
                >
                  Повторить
                </Button>
              </div>
            )}
            {result && !page && (
              <p className="text-copy-muted p-8 text-center text-sm">
                Запрошенная страница отсутствует в зафиксированном результате
                обработки.
              </p>
            )}
            {page && (
              <RenderedDocumentPage
                className="h-full max-h-none rounded-none"
                file={file}
                matchIds={matchIds}
                evidenceRects={evidenceRects}
                objectId={objectId}
                onSelect={setSelectedBlockId}
                page={page}
                selectedId={selectedBlockId}
                zoom={zoom}
              />
            )}
          </DocumentViewerModal>
        </div>
      </div>

      {evidence.length > 0 ? (
        <div
          className="border-line border-b px-4 py-2 text-xs"
          aria-label="Цитаты на этой странице"
        >
          {evidence.map((fragment, index) => (
            <blockquote key={index}>{fragment.quote}</blockquote>
          ))}
        </div>
      ) : null}
      <div className="bg-surface-low min-h-72 flex-1 overflow-hidden">
        {query.isPending && (
          <p role="status" className="text-copy-muted p-8 text-center text-sm">
            Загружаем результат обработки…
          </p>
        )}
        {query.error && (
          <div className="space-y-3 p-6" role="alert">
            <p className="text-danger text-sm">
              {parsingErrorMessage(query.error)}
            </p>
            <Button
              onPress={() => {
                void query.refetch();
              }}
              size="sm"
              variant="outline"
            >
              Повторить
            </Button>
          </div>
        )}
        {result && !page && (
          <p className="text-copy-muted p-8 text-center text-sm">
            Запрошенная страница отсутствует в зафиксированном результате
            обработки.
          </p>
        )}
        {page && (
          <RenderedDocumentPage
            className="h-full max-h-none rounded-none"
            file={file}
            matchIds={matchIds}
            evidenceRects={evidenceRects}
            objectId={objectId}
            onSelect={setSelectedBlockId}
            page={page}
            selectedId={selectedBlockId}
            zoom={zoom}
          />
        )}
      </div>
    </section>
  );
}
