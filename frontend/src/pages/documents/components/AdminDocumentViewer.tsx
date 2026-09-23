import { Button, type UseOverlayStateReturn } from "@heroui/react";
import { useState } from "react";

import { useAdminParseResult } from "@/api/hooks/use-admin-documents";
import { parsingErrorMessage } from "@/api/hooks/use-parsing";
import type { AdminDocument } from "@/api/types/admin-documents";
import type { ParsingFile } from "@/api/types/parsing";
import { DocumentViewerModal } from "@/components/document-viewer-modal/DocumentViewerModal";
import { RenderedDocumentPage } from "@/components/rendered-document-page/RenderedDocumentPage";
import { UploadIcon, type UploadIconName } from "@/components/UploadIcon";

const emptyMatchIds: ReadonlySet<string> = new Set<string>();

function ToolbarButton({
  ariaLabel,
  icon,
  isDisabled,
  onPress,
}: {
  ariaLabel: string;
  icon: UploadIconName;
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
      <UploadIcon className="size-4.5" name={icon} />
    </Button>
  );
}

export function AdminDocumentViewer({
  document,
  state,
}: {
  document: AdminDocument | null;
  state: UseOverlayStateReturn;
}) {
  const query = useAdminParseResult(document);
  const result = query.isError ? undefined : query.data;
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  const pages = result?.artifact.pages ?? [];
  const pageData = pages.find((item) => item.page_number === page) ?? pages[0];
  const currentPage = pageData?.page_number ?? 1;
  const totalPages = pages.length;

  const file: ParsingFile | null = document && {
    file_id: document.id,
    process_id: document.process_id,
    run_id: document.run_id,
    original_name: document.original_name,
    state: "succeeded",
    attempt: 0,
    pages_completed: 0,
    pages_total: document.parsing?.pages_total ?? null,
    quality: null,
    reasons: [],
    error_code: document.parsing?.error_code ?? null,
    can_retry: false,
    artifact_id: document.parsing?.artifact_id ?? null,
  };

  return (
    <DocumentViewerModal
      pageLabel={totalPages ? `Стр. ${currentPage} из ${totalPages}` : "Стр. —"}
      state={state}
      title={document?.original_name ?? "Документ"}
      toolbar={
        <>
          <div className="flex items-center gap-1">
            <ToolbarButton
              ariaLabel="Предыдущая страница"
              icon="chevron-left"
              isDisabled={!pageData || currentPage <= 1}
              onPress={() => {
                setSelectedBlockId(null);
                setPage(currentPage - 1);
              }}
            />
            <span className="text-foreground min-w-16 text-center text-xs tabular-nums">
              {pageData ? currentPage : "—"} / {totalPages || "—"}
            </span>
            <ToolbarButton
              ariaLabel="Следующая страница"
              icon="chevron-right"
              isDisabled={!pageData || currentPage >= totalPages}
              onPress={() => {
                setSelectedBlockId(null);
                setPage(currentPage + 1);
              }}
            />
          </div>
          <span
            aria-hidden="true"
            className="bg-line hidden h-5 w-px sm:block"
          />
          <div className="flex items-center gap-1">
            <ToolbarButton
              ariaLabel="Уменьшить масштаб"
              icon="zoom-out"
              isDisabled={typeof zoom === "number" && zoom <= 0.5}
              onPress={() =>
                setZoom(Math.max(0.5, (zoom === "fit" ? 1 : zoom) - 0.25))
              }
            />
            <span className="text-foreground min-w-16 text-center text-xs tabular-nums">
              {zoom === "fit" ? "По ширине" : `${Math.round(zoom * 100)}%`}
            </span>
            <ToolbarButton
              ariaLabel="Увеличить масштаб"
              icon="zoom-in"
              isDisabled={typeof zoom === "number" && zoom >= 1.5}
              onPress={() =>
                setZoom(Math.min(1.5, (zoom === "fit" ? 1 : zoom) + 0.25))
              }
            />
            <ToolbarButton
              ariaLabel="Уместить страницу по ширине"
              icon="fit"
              isDisabled={zoom === "fit"}
              onPress={() => setZoom("fit")}
            />
          </div>
        </>
      }
    >
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
      {result && !pageData && (
        <p className="text-copy-muted p-8 text-center text-sm">
          В результате обработки нет страниц для предпросмотра.
        </p>
      )}
      {pageData && file && (
        <RenderedDocumentPage
          admin
          className="h-full max-h-none rounded-none"
          file={file}
          matchIds={emptyMatchIds}
          objectId={document!.object_id}
          onSelect={setSelectedBlockId}
          page={pageData}
          selectedId={selectedBlockId}
          zoom={zoom}
        />
      )}
    </DocumentViewerModal>
  );
}
