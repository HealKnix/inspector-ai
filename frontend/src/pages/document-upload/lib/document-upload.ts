import type { ClassificationFile } from "@/api/types/classification";
import type { ObjectFile } from "@/api/types/objects";
import type { ParsingFile } from "@/api/types/parsing";
import { metadataIssueMessage, sourceIssueMessage } from "./review-status";

import {
  DocumentStage,
  INTERACTIVE_UPLOAD_LIMITS,
  SupportedUploadExtension,
  UploadDocumentFilter,
  UploadRetryKind,
  UploadRowOrigin,
  UploadRowStatus,
  UploadValidationErrorCode,
  type PendingUploadFile,
  type UploadDocumentFilterOptions,
  type UploadLimits,
  type UploadRow,
  type UploadSummary,
  type UploadValidationError,
  type UploadValidationResult,
} from "../types";

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

const remoteExtension = {
  PDF: SupportedUploadExtension.PDF,
  DOCX: SupportedUploadExtension.DOCX,
  XML: SupportedUploadExtension.XML,
} as const;

export function createPendingUploadFile(
  file: File,
  declaredStage: DocumentStage,
): PendingUploadFile {
  const extension = getSupportedExtension(
    file.name,
    INTERACTIVE_UPLOAD_LIMITS.allowedExtensions,
  );

  if (extension === null) {
    throw new Error(`Неподдерживаемый формат файла «${file.name}».`);
  }

  return {
    clientFileId: crypto.randomUUID(),
    file,
    declaredStage,
    acceptedFileId: null,
    outcome: null,
  };
}

export function localUploadRow(
  pending: PendingUploadFile,
  uploading: boolean,
): UploadRow {
  const extension =
    getSupportedExtension(
      pending.file.name,
      INTERACTIVE_UPLOAD_LIMITS.allowedExtensions,
    ) ?? SupportedUploadExtension.PDF;

  let status: UploadRowStatus = UploadRowStatus.PENDING;
  let statusDetail: string | null = null;

  if (pending.outcome) {
    status = pending.outcome.duplicate
      ? UploadRowStatus.DUPLICATE
      : UploadRowStatus.REJECTED;
    statusDetail = pending.outcome.message;
  } else if (pending.acceptedFileId) {
    status = UploadRowStatus.ACCEPTED;
  } else if (uploading) {
    status = UploadRowStatus.UPLOADING;
  }

  return {
    id: pending.clientFileId,
    origin: UploadRowOrigin.LOCAL,
    name: pending.file.name,
    extension,
    sizeBytes: pending.file.size,
    clientFileId: pending.clientFileId,
    fileId: pending.acceptedFileId,
    sha256: null,
    integrityError: false,
    pageCount: null,
    declaredStage: pending.declaredStage,
    detectedStage: null,
    documentKind: null,
    stage: pending.declaredStage,
    stageMismatch: false,
    status,
    statusDetail,
    needsReview: false,
    retryKind: null,
    existingFileId: pending.outcome?.existingFileId ?? null,
  };
}

export function remoteUploadRow(
  file: ObjectFile,
  parsing: ParsingFile | undefined,
  classification: ClassificationFile | undefined,
  declaredStage: DocumentStage | null,
): UploadRow {
  // A result from a previous run/artifact must never dismiss a current question.
  const currentClassification =
    classification &&
    parsing &&
    classification.file_id === parsing.file_id &&
    classification.process_id === parsing.process_id &&
    classification.run_id === parsing.run_id &&
    classification.artifact_id === parsing.artifact_id
      ? classification
      : undefined;
  const review = currentClassification?.review;
  const reviewedStage = review?.fields.stage;
  const detectedStage =
    reviewedStage === "PD" || reviewedStage === "RD" || reviewedStage === "ID"
      ? reviewedStage
      : (currentClassification?.result?.stage ?? null);
  const reasons =
    review?.reasons ?? currentClassification?.result?.reasons ?? [];
  const sourceIssues =
    review?.source_issues ??
    reasons.filter(
      (reason) =>
        reason.startsWith("unsupported_") ||
        [
          "partial_parse_requires_review",
          "possible_mixed_document",
          "source_unreadable",
          "source_integrity_mismatch",
        ].includes(reason),
    );
  const needsReview =
    sourceIssues.length > 0 ||
    (review?.needs_review ??
      currentClassification?.result?.needs_review === true);

  let status: UploadRowStatus = UploadRowStatus.ACCEPTED;
  let statusDetail: string | null = null;
  let retryKind: UploadRetryKind | null = null;

  if (file.integrity_error) {
    status = UploadRowStatus.FAILED;
    statusDetail = "Нарушена целостность оригинала";
  } else if (parsing?.state === "queued") {
    status = UploadRowStatus.QUEUED;
  } else if (parsing?.state === "processing") {
    status = UploadRowStatus.PROCESSING;
    statusDetail =
      parsing.pages_total === null
        ? `${parsing.pages_completed} стр.`
        : `${parsing.pages_completed} / ${parsing.pages_total} стр.`;
  } else if (parsing?.state === "failed") {
    status = UploadRowStatus.FAILED;
    statusDetail = "Не удалось прочитать файл. Повторите обработку.";
    if (parsing.can_retry) retryKind = UploadRetryKind.PARSING;
  } else if (parsing?.state === "succeeded") {
    if (
      !currentClassification ||
      currentClassification.state === "queued" ||
      currentClassification.state === "processing"
    ) {
      status = UploadRowStatus.CLASSIFYING;
    } else if (currentClassification.state === "failed") {
      status = UploadRowStatus.FAILED;
      statusDetail = "Не удалось определить сведения. Повторите обработку.";
      if (currentClassification.can_retry)
        retryKind = UploadRetryKind.CLASSIFICATION;
    } else if (needsReview) {
      status = UploadRowStatus.NEEDS_REVIEW;
      statusDetail =
        sourceIssueMessage(sourceIssues) ?? metadataIssueMessage(reasons);
    } else {
      status = UploadRowStatus.READY;
    }
  }

  return {
    id: file.id,
    origin: UploadRowOrigin.REMOTE,
    name: file.original_name,
    extension: remoteExtension[file.format],
    sizeBytes: file.size,
    clientFileId: null,
    fileId: file.id,
    sha256: file.sha256,
    integrityError: file.integrity_error,
    pageCount: parsing?.pages_total ?? null,
    declaredStage,
    detectedStage,
    documentKind:
      review?.fields.title ||
      review?.fields.kind_code ||
      currentClassification?.result?.document_kind ||
      null,
    documentCode: review?.fields.code ?? null,
    revisionLabel: review?.fields.revision_label ?? null,
    reviewed: Boolean(review?.confirmed_fields.length) && !review?.needs_review,
    sourceIssue: sourceIssues.length > 0,
    stage: detectedStage ?? declaredStage,
    stageMismatch: Boolean(
      declaredStage && detectedStage && declaredStage !== detectedStage,
    ),
    status,
    statusDetail,
    needsReview,
    retryKind,
    existingFileId: null,
  };
}

export function getUploadSummary(rows: readonly UploadRow[]): UploadSummary {
  const summary: UploadSummary = {
    totalFiles: rows.length,
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
    pendingCount: 0,
    failedCount: 0,
  };

  for (const row of rows) {
    summary.totalKnownPages += row.pageCount ?? 0;
    summary.totalSizeBytes += row.sizeBytes;

    if (row.stage === null) {
      summary.unclassifiedCount += 1;
    } else {
      summary.stageCounts[row.stage] += 1;
    }

    if (row.origin === UploadRowOrigin.LOCAL) {
      summary.pendingCount += 1;
    }
    if (row.status === UploadRowStatus.FAILED) {
      summary.failedCount += 1;
    }
    if (row.needsReview) {
      summary.needsReviewCount += 1;
    } else if (row.status === UploadRowStatus.READY) {
      summary.readyCount += 1;
    }
  }

  return summary;
}

export function filterUploadRows(
  rows: readonly UploadRow[],
  { filter, query }: UploadDocumentFilterOptions,
): UploadRow[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");

  return rows.filter((row) => {
    const matchesFilter =
      filter === UploadDocumentFilter.ALL ||
      (filter === UploadDocumentFilter.NEEDS_REVIEW && row.needsReview) ||
      (filter === UploadDocumentFilter.FAILED &&
        row.status === UploadRowStatus.FAILED) ||
      row.stage === filter;

    if (!matchesFilter || normalizedQuery.length === 0) {
      return matchesFilter;
    }

    const searchableValues = [
      row.name,
      row.stage,
      row.declaredStage,
      row.detectedStage,
      row.statusDetail,
      row.sha256,
      row.extension,
    ];

    return searchableValues.some(
      (value) =>
        value !== null &&
        String(value).toLocaleLowerCase("ru-RU").includes(normalizedQuery),
    );
  });
}

export function validateUploadFiles(
  pendingSizeBytes: number,
  files: readonly File[],
  limits: UploadLimits = INTERACTIVE_UPLOAD_LIMITS,
): UploadValidationResult {
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
  const requestedPackageSizeBytes = pendingSizeBytes + acceptedSizeBytes;

  if (requestedPackageSizeBytes > limits.maxPackageSizeBytes) {
    errors.push({
      code: UploadValidationErrorCode.PACKAGE_SIZE_EXCEEDED,
      fileName: null,
      message: `Выбранные файлы превышают общий лимит пакета ${formatMebibytes(limits.maxPackageSizeBytes)} МБ.`,
    });

    return {
      acceptedFiles: [],
      errors,
      pendingSizeBytes,
      acceptedSizeBytes: 0,
      resultingPackageSizeBytes: pendingSizeBytes,
    };
  }

  return {
    acceptedFiles,
    errors,
    pendingSizeBytes,
    acceptedSizeBytes,
    resultingPackageSizeBytes: requestedPackageSizeBytes,
  };
}
