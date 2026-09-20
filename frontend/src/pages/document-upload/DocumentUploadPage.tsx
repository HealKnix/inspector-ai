import { Button } from "@heroui/react";
import { useMemo, useState } from "react";

import { mockUploadPackage } from "@/data/document-upload";
import {
  createLocalUploadDocument,
  filterUploadDocuments,
  getUploadSummary,
  validateUploadFiles,
} from "@/pages/document-upload/lib/document-upload";
import type {
  UploadDocument,
  UploadDocumentFilter,
} from "@/pages/document-upload/types";

import { FileDropzone } from "@/components/file-dropzone/FileDropzone";
import { UploadIcon } from "@/components/UploadIcon";
import { ConstrainedLayout } from "../../layouts/ConstrainedLayout";
import { CompletenessPanel } from "./components/CompletenessPanel";
import { DocumentsTable } from "./components/DocumentsTable";
import { MetadataAssistant } from "./components/MetadataAssistant";
import { UploadHeader } from "./components/UploadHeader";
import { UploadSteps } from "./components/UploadSteps";
import { UploadSummary } from "./components/UploadSummary";

export function DocumentUploadPage() {
  const [documents, setDocuments] = useState<UploadDocument[]>(() => [
    ...mockUploadPackage.documents,
  ]);
  const [filter, setFilter] = useState<UploadDocumentFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const summary = useMemo(() => getUploadSummary(documents), [documents]);
  const visibleDocuments = useMemo(
    () => filterUploadDocuments(documents, { filter, query }),
    [documents, filter, query],
  );
  const isUnmodifiedMockPackage =
    documents.length === mockUploadPackage.documents.length &&
    documents.every(
      (document, index) =>
        document.id === mockUploadPackage.documents[index]?.id,
    );

  const handleFilesSelected = (files: readonly File[]) => {
    if (files.length === 0) return;

    const validation = validateUploadFiles(
      documents,
      files,
      mockUploadPackage.uploadLimits,
    );
    setValidationErrors(validation.errors.map((error) => error.message));

    if (validation.acceptedFiles.length === 0) return;

    const localDocuments = validation.acceptedFiles.map((file) =>
      createLocalUploadDocument(file, mockUploadPackage.objectId),
    );
    setDocuments((currentDocuments) => [
      ...currentDocuments,
      ...localDocuments,
    ]);
  };

  const handleRemoveDocument = (documentId: string) => {
    setDocuments((currentDocuments) =>
      currentDocuments.filter((document) => document.id !== documentId),
    );
    setSelectedIds((currentSelectedIds) => {
      const nextSelectedIds = new Set(currentSelectedIds);
      nextSelectedIds.delete(documentId);
      return nextSelectedIds;
    });
  };

  const handleClear = () => {
    setDocuments([]);
    setSelectedIds(new Set());
    setValidationErrors([]);
    setFilter("all");
    setQuery("");
  };

  const handleRemoveSelected = () => {
    setDocuments((currentDocuments) =>
      currentDocuments.filter((document) => !selectedIds.has(document.id)),
    );
    setSelectedIds(new Set());
  };

  const handleReviewMetadata = () => {
    setFilter("needs-review");
    setQuery("");
    document
      .getElementById("uploaded-documents")
      ?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  };

  return (
    <ConstrainedLayout>
      <div className="mt-3 pb-12">
        <UploadHeader fixtureNotice={mockUploadPackage.fixtureNotice} />
        <UploadSteps activeStep={documents.length > 0 ? 2 : 1} />

        <div className="mt-5 grid items-start gap-4 min-[1100px]:grid-cols-12">
          <div className="grid gap-4 min-[760px]:grid-cols-12 min-[1100px]:col-span-8">
            <div className="min-[760px]:col-span-7">
              <FileDropzone
                errors={validationErrors}
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
          </div>

          <div className="min-[1100px]:col-span-4">
            <CompletenessPanel
              hasDocuments={summary.totalFiles > 0}
              missingRequiredSourceParameterCount={
                mockUploadPackage.controlledParametersWithoutSources
              }
              showMockFindings={isUnmodifiedMockPackage}
              stageCounts={summary.stageCounts}
            />
          </div>

          <div className="min-w-0 min-[1100px]:col-span-8">
            <DocumentsTable
              documents={visibleDocuments}
              filter={filter}
              needsReviewCount={summary.needsReviewCount}
              onFilterChange={setFilter}
              onQueryChange={setQuery}
              onRemoveDocument={handleRemoveDocument}
              onSelectedIdsChange={setSelectedIds}
              query={query}
              selectedIds={selectedIds}
              stageCounts={summary.stageCounts}
              totalFiles={summary.totalFiles}
            />
          </div>

          <div className="min-[1100px]:col-span-4">
            <MetadataAssistant
              needsReviewCount={summary.needsReviewCount}
              onReview={handleReviewMetadata}
            />
          </div>
        </div>
      </div>

      <div className="border-border bg-background/75 absolute inset-x-0 bottom-0 z-20 mt-5 flex min-h-18 items-center gap-3 border-t px-4 py-3 backdrop-blur-md min-[720px]:justify-end min-[1400px]:px-8 sm:px-6">
        <p className="text-copy-muted mr-auto hidden text-sm min-[720px]:block">
          Выбрано {selectedIds.size} файлов
        </p>
        <Button
          aria-label={
            selectedIds.size > 0 ? "Удалить выбранные файлы" : "Очистить список"
          }
          className="rounded-xl"
          isDisabled={documents.length === 0}
          onPress={selectedIds.size > 0 ? handleRemoveSelected : handleClear}
          variant={selectedIds.size > 0 ? "danger-soft" : "outline"}
        >
          <UploadIcon className="size-4.5" name="trash" />
          <span className="hidden sm:inline">
            {selectedIds.size > 0
              ? `Удалить выбранные (${selectedIds.size})`
              : "Очистить список"}
          </span>
        </Button>
        <Button
          className="min-w-0 flex-1 rounded-xl min-[520px]:min-w-52 min-[520px]:flex-none"
          isDisabled={summary.needsReviewCount === 0}
          onPress={handleReviewMetadata}
        >
          <UploadIcon className="size-4.5" name="play" />
          Проверить метаданные
        </Button>
      </div>
    </ConstrainedLayout>
  );
}
