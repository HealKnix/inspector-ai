import {
  DocumentStage,
  INTERACTIVE_UPLOAD_LIMITS,
  MetadataPresentationState,
  SupportedUploadExtension,
  UploadDocumentSource,
  UploadValidationErrorCode,
  type UploadDocument,
  type UploadDocumentFilterOptions,
  type UploadLimits,
  type UploadSummary,
  type UploadValidationError,
  type UploadValidationResult,
} from "../types";

const fallbackMimeTypes = {
  [SupportedUploadExtension.PDF]: "application/pdf",
  [SupportedUploadExtension.DOCX]:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  [SupportedUploadExtension.XML]: "application/xml",
} satisfies Record<SupportedUploadExtension, string>;

let fallbackLocalDocumentSequence = 0;

function createLocalDocumentId(objectId: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();

  if (uuid) {
    return `local:${objectId}:${uuid}`;
  }

  fallbackLocalDocumentSequence += 1;

  return `local:${objectId}:${Date.now().toString(36)}:${fallbackLocalDocumentSequence.toString(36)}`;
}

function getExtension(fileName: string): string | null {
  const separatorIndex = fileName.lastIndexOf(".");

  if (separatorIndex < 0 || separatorIndex === fileName.length - 1) {
    return null;
  }

  return fileName.slice(separatorIndex + 1).toLowerCase();
}

function getSupportedExtension(
  fileName: string,
  allowedExtensions: readonly SupportedUploadExtension[],
): SupportedUploadExtension | null {
  const extension = getExtension(fileName);

  return allowedExtensions.find((allowed) => allowed === extension) ?? null;
}

function formatMebibytes(bytes: number): string {
  const value = bytes / (1024 * 1024);
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function getUploadSummary(
  documents: readonly UploadDocument[],
): UploadSummary {
  const summary: UploadSummary = {
    totalFiles: documents.length,
    totalKnownPages: 0,
    totalSizeBytes: 0,
    stageCounts: {
      [DocumentStage.PD]: 0,
      [DocumentStage.RD]: 0,
      [DocumentStage.ID]: 0,
    },
    readyCount: 0,
    needsReviewCount: 0,
    unclassifiedCount: 0,
  };

  for (const document of documents) {
    summary.totalKnownPages += document.pageCount ?? 0;
    summary.totalSizeBytes += document.sizeBytes;

    if (document.stage === null) {
      summary.unclassifiedCount += 1;
    } else {
      summary.stageCounts[document.stage] += 1;
    }

    if (document.metadataState === MetadataPresentationState.READY) {
      summary.readyCount += 1;
    } else {
      summary.needsReviewCount += 1;
    }
  }

  return summary;
}

export function filterUploadDocuments(
  documents: readonly UploadDocument[],
  { filter, query }: UploadDocumentFilterOptions,
): UploadDocument[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");

  return documents.filter((document) => {
    const matchesFilter =
      filter === "all" ||
      (filter === MetadataPresentationState.NEEDS_REVIEW
        ? document.metadataState === MetadataPresentationState.NEEDS_REVIEW
        : document.stage === filter);

    if (!matchesFilter || normalizedQuery.length === 0) {
      return matchesFilter;
    }

    const searchableValues = [
      document.name,
      document.objectId,
      document.stage,
      document.section,
      document.cipher,
      document.revision,
      document.approvalStatus,
      document.approvalDate,
      document.sheetNumber,
      document.pageNumber,
      document.fileHash,
      document.predecessorRevisionReference,
      document.successorRevisionReference,
      document.metadataNote,
      document.extension,
    ];

    return searchableValues.some(
      (value) =>
        value !== null &&
        String(value).toLocaleLowerCase("ru-RU").includes(normalizedQuery),
    );
  });
}

export function validateUploadFiles(
  existingDocuments: readonly UploadDocument[],
  files: readonly File[],
  limits: UploadLimits = INTERACTIVE_UPLOAD_LIMITS,
): UploadValidationResult {
  const existingSizeBytes = existingDocuments.reduce(
    (total, document) => total + document.sizeBytes,
    0,
  );
  const acceptedFiles: File[] = [];
  const errors: UploadValidationError[] = [];

  for (const file of files) {
    const extension = getSupportedExtension(
      file.name,
      limits.allowedExtensions,
    );
    const fileErrors: UploadValidationError[] = [];

    if (extension === null) {
      fileErrors.push({
        code: UploadValidationErrorCode.UNSUPPORTED_FORMAT,
        fileName: file.name,
        message: `Файл «${file.name}» имеет неподдерживаемый формат. Допустимы PDF, DOCX и XML.`,
      });
    }

    if (file.size > limits.maxFileSizeBytes) {
      fileErrors.push({
        code: UploadValidationErrorCode.FILE_SIZE_EXCEEDED,
        fileName: file.name,
        message: `Файл «${file.name}» превышает лимит ${formatMebibytes(limits.maxFileSizeBytes)} МБ.`,
      });
    }

    errors.push(...fileErrors);

    if (fileErrors.length === 0) {
      acceptedFiles.push(file);
    }
  }

  const acceptedSizeBytes = acceptedFiles.reduce(
    (total, file) => total + file.size,
    0,
  );
  const requestedPackageSizeBytes = existingSizeBytes + acceptedSizeBytes;

  if (requestedPackageSizeBytes > limits.maxPackageSizeBytes) {
    errors.push({
      code: UploadValidationErrorCode.PACKAGE_SIZE_EXCEEDED,
      fileName: null,
      message: `Выбранные файлы превышают общий лимит пакета ${formatMebibytes(limits.maxPackageSizeBytes)} МБ.`,
    });

    return {
      acceptedFiles: [],
      errors,
      existingSizeBytes,
      acceptedSizeBytes: 0,
      resultingPackageSizeBytes: existingSizeBytes,
    };
  }

  return {
    acceptedFiles,
    errors,
    existingSizeBytes,
    acceptedSizeBytes,
    resultingPackageSizeBytes: requestedPackageSizeBytes,
  };
}

export function createLocalUploadDocument(
  file: File,
  objectId: string,
): UploadDocument {
  const extension = getSupportedExtension(
    file.name,
    INTERACTIVE_UPLOAD_LIMITS.allowedExtensions,
  );

  if (extension === null) {
    throw new Error(`Неподдерживаемый формат файла «${file.name}».`);
  }

  return {
    id: createLocalDocumentId(objectId),
    objectId,
    name: file.name,
    extension,
    mimeType: file.type || fallbackMimeTypes[extension],
    sizeBytes: file.size,
    pageCount: null,
    stage: null,
    section: null,
    cipher: null,
    revision: null,
    approvalStatus: null,
    approvalDate: null,
    sheetNumber: null,
    pageNumber: null,
    fileHash: null,
    predecessorRevisionReference: null,
    successorRevisionReference: null,
    metadataState: MetadataPresentationState.NEEDS_REVIEW,
    metadataNote: "Метаданные ещё не определены.",
    source: UploadDocumentSource.LOCAL_BROWSER,
    isSynthetic: false,
  };
}
