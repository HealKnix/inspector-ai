import {
  Button,
  ToggleButton,
  ToggleButtonGroup,
  type Key,
} from "@heroui/react";
import { useState } from "react";

import { DocumentViewerModal } from "@/components/document-viewer-modal/DocumentViewerModal";
import { cn } from "@/lib/utils";
import {
  VerificationDocumentStage,
  type VerificationDocumentStage as DocumentStage,
  type VerificationDocument,
  type VerificationEvidence,
} from "@/pages/verification/types";
import { DocumentPreview } from "./DocumentPreview";
import { VerificationIcon } from "./VerificationIcon";

const documentStages = Object.values(VerificationDocumentStage);
const zoomLevels = [75, 100, 125, 150] as const;
type ZoomLevel = (typeof zoomLevels)[number];

export interface DocumentPaneProps {
  className?: string;
  documentId: string;
  documents: readonly VerificationDocument[];
  evidence?: VerificationEvidence;
  label: string;
  onDocumentChange?: (document: VerificationDocument) => void;
  onPageChange: (page: number) => void;
  page: number;
}

function clampPage(page: number, totalPages: number) {
  return Math.min(Math.max(Math.trunc(page), 1), Math.max(totalPages, 1));
}

function StageSelector({
  activeStage,
  availableStages,
  label,
  onStageChange,
}: {
  activeStage: DocumentStage | undefined;
  availableStages: ReadonlySet<DocumentStage>;
  label: string;
  onStageChange: (stage: DocumentStage) => void;
}) {
  const handleSelectionChange = (keys: Set<Key>) => {
    const selectedStage = keys.values().next().value;

    if (
      typeof selectedStage === "string" &&
      documentStages.includes(selectedStage as DocumentStage)
    ) {
      onStageChange(selectedStage as DocumentStage);
    }
  };

  return (
    <ToggleButtonGroup
      aria-label={`Массив документов: ${label}`}
      className="bg-surface-high flex rounded-xl p-1"
      disallowEmptySelection
      isDetached
      onSelectionChange={handleSelectionChange}
      selectedKeys={new Set<Key>(activeStage ? [activeStage] : [])}
      selectionMode="single"
      size="sm"
    >
      {documentStages.map((stage) => {
        const isSelected = stage === activeStage;

        return (
          <ToggleButton
            className={cn(
              "h-8 min-w-10 rounded-lg px-2.5 text-xs font-semibold",
              isSelected ? "bg-card text-primary shadow-sm" : "text-foreground",
            )}
            id={stage}
            isDisabled={!availableStages.has(stage)}
            key={stage}
            variant="ghost"
          >
            {stage}
          </ToggleButton>
        );
      })}
    </ToggleButtonGroup>
  );
}

function ToolbarButton({
  ariaLabel,
  icon,
  isDisabled,
  onPress,
}: {
  ariaLabel: string;
  icon:
    | "chevron-left"
    | "chevron-right"
    | "expand"
    | "fit"
    | "zoom-in"
    | "zoom-out";
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

export function DocumentPane({
  className,
  documentId,
  documents,
  evidence,
  label,
  onDocumentChange,
  onPageChange,
  page,
}: DocumentPaneProps) {
  const [zoom, setZoom] = useState<ZoomLevel>(100);

  const document =
    documents.find((candidate) => candidate.id === documentId) ?? documents[0];

  if (!document) {
    return (
      <section
        aria-label={label}
        className={cn(
          "border-line bg-card grid min-h-96 place-items-center rounded-2xl border p-6",
          className,
        )}
      >
        <p className="text-copy-muted text-sm">
          Документы для просмотра отсутствуют
        </p>
      </section>
    );
  }

  const availableStages = new Set(
    documents
      .map((item) => item.stage)
      .filter((stage): stage is DocumentStage => stage !== undefined),
  );
  const currentPage = clampPage(page, document.totalPages);
  const zoomIndex = zoomLevels.indexOf(zoom);
  const isApproved = document.approvalStatus
    .toLocaleLowerCase("ru-RU")
    .includes("утвержден");

  const selectStage = (stage: DocumentStage) => {
    const nextDocument = documents.find((item) => item.stage === stage);
    if (!nextDocument || nextDocument.id === document.id) return;

    onDocumentChange?.(nextDocument);
    onPageChange(1);
  };

  return (
    <section
      aria-label={`${label}: просмотр документа`}
      className={cn(
        "border-line bg-card flex min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border",
        className,
      )}
    >
      <header className="border-line border-b px-4 pt-4 sm:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 gap-3">
            <span className="bg-surface-high text-copy-muted grid size-10 shrink-0 place-items-center rounded-xl">
              <VerificationIcon className="size-5" name="document" />
            </span>
            <div className="min-w-0">
              <p className="text-copy-muted text-[11px] font-semibold tracking-[0.08em] uppercase">
                {label}
              </p>
              <h2 className="mt-0.5 truncate text-sm font-semibold sm:text-base">
                {document.title}
              </h2>
              <p className="text-copy-muted mt-1 truncate text-xs">
                {document.fileName}
              </p>
            </div>
          </div>

          <StageSelector
            activeStage={document.stage}
            availableStages={availableStages}
            label={label}
            onStageChange={selectStage}
          />
        </div>

        <div className="text-copy-muted mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 pb-4 text-[11px]">
          <span>
            Шифр: <strong className="text-foreground">{document.cipher}</strong>
          </span>
          <span>
            Редакция:{" "}
            <strong className="text-foreground">{document.revision}</strong>
          </span>
          <span>
            Изменение:{" "}
            <strong className="text-foreground">
              {document.changeReference}
            </strong>
          </span>
          <span
            className={cn(
              "ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium",
              isApproved
                ? "bg-success/10 text-foreground"
                : "bg-warning/10 text-foreground",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 rounded-full",
                isApproved ? "bg-success" : "bg-warning",
              )}
            />
            {document.approvalStatus}
          </span>
        </div>
      </header>

      <div className="border-line flex min-h-12 flex-wrap items-center gap-1 border-b px-3 py-1.5 sm:px-4">
        <div className="flex items-center gap-1">
          <ToolbarButton
            ariaLabel="Предыдущая страница"
            icon="chevron-left"
            isDisabled={currentPage <= 1}
            onPress={() => onPageChange(currentPage - 1)}
          />
          <span className="text-copy-muted min-w-16 text-center text-xs tabular-nums">
            <strong className="text-foreground font-semibold">
              {currentPage}
            </strong>{" "}
            / {document.totalPages}
          </span>
          <ToolbarButton
            ariaLabel="Следующая страница"
            icon="chevron-right"
            isDisabled={currentPage >= document.totalPages}
            onPress={() => onPageChange(currentPage + 1)}
          />
        </div>

        <span aria-hidden="true" className="bg-line mx-1 h-5 w-px" />

        <div className="flex items-center gap-1">
          <ToolbarButton
            ariaLabel="Уменьшить масштаб"
            icon="zoom-out"
            isDisabled={zoomIndex === 0}
            onPress={() => {
              const nextZoom = zoomLevels[zoomIndex - 1];
              if (nextZoom) setZoom(nextZoom);
            }}
          />
          <span className="text-copy-muted min-w-12 text-center text-xs tabular-nums">
            {zoom}%
          </span>
          <ToolbarButton
            ariaLabel="Увеличить масштаб"
            icon="zoom-in"
            isDisabled={zoomIndex === zoomLevels.length - 1}
            onPress={() => {
              const nextZoom = zoomLevels[zoomIndex + 1];
              if (nextZoom) setZoom(nextZoom);
            }}
          />
          <ToolbarButton
            ariaLabel="Установить масштаб 100%"
            icon="fit"
            isDisabled={zoom === 100}
            onPress={() => setZoom(100)}
          />
        </div>

        <div className="ml-auto">
          <DocumentViewerModal
            contentClassName="p-3 sm:p-6"
            pageLabel={`Стр. ${currentPage} из ${document.totalPages}`}
            title={document.title}
            toolbar={
              <>
                <StageSelector
                  activeStage={document.stage}
                  availableStages={availableStages}
                  label={`${label}, полноэкранный просмотр`}
                  onStageChange={selectStage}
                />
                <div className="flex items-center gap-1">
                  <ToolbarButton
                    ariaLabel="Предыдущая страница в полноэкранном просмотре"
                    icon="chevron-left"
                    isDisabled={currentPage <= 1}
                    onPress={() => onPageChange(currentPage - 1)}
                  />
                  <span className="text-foreground min-w-16 text-center text-xs tabular-nums">
                    {currentPage} / {document.totalPages}
                  </span>
                  <ToolbarButton
                    ariaLabel="Следующая страница в полноэкранном просмотре"
                    icon="chevron-right"
                    isDisabled={currentPage >= document.totalPages}
                    onPress={() => onPageChange(currentPage + 1)}
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
                    isDisabled={zoomIndex === 0}
                    onPress={() => {
                      const nextZoom = zoomLevels[zoomIndex - 1];
                      if (nextZoom) setZoom(nextZoom);
                    }}
                  />
                  <span className="text-foreground min-w-12 text-center text-xs tabular-nums">
                    {zoom}%
                  </span>
                  <ToolbarButton
                    ariaLabel="Увеличить масштаб в полноэкранном просмотре"
                    icon="zoom-in"
                    isDisabled={zoomIndex === zoomLevels.length - 1}
                    onPress={() => {
                      const nextZoom = zoomLevels[zoomIndex + 1];
                      if (nextZoom) setZoom(nextZoom);
                    }}
                  />
                  <ToolbarButton
                    ariaLabel="Установить масштаб 100% в полноэкранном просмотре"
                    icon="fit"
                    isDisabled={zoom === 100}
                    onPress={() => setZoom(100)}
                  />
                </div>
              </>
            }
          >
            <DocumentPreview
              document={document}
              evidence={
                evidence?.documentId === document.id ? evidence : undefined
              }
              page={currentPage}
              zoom={zoom}
            />
          </DocumentViewerModal>
        </div>
      </div>

      <div className="bg-surface-low min-h-[440px] flex-1 overflow-auto p-3 sm:p-5">
        <DocumentPreview
          document={document}
          evidence={evidence?.documentId === document.id ? evidence : undefined}
          page={currentPage}
          zoom={zoom}
        />
      </div>
    </section>
  );
}
