export const DocumentStage = {
  PD: "PD",
  RD: "RD",
  ID: "ID",
} as const;

export type DocumentStage = (typeof DocumentStage)[keyof typeof DocumentStage];

export const SupportedUploadExtension = {
  PDF: "pdf",
  DOCX: "docx",
  XML: "xml",
} as const;

export type SupportedUploadExtension =
  (typeof SupportedUploadExtension)[keyof typeof SupportedUploadExtension];

export interface UploadLimits {
  readonly maxFileSizeBytes: number;
  readonly maxPackageSizeBytes: number;
  readonly allowedExtensions: readonly SupportedUploadExtension[];
}

export const INTERACTIVE_UPLOAD_LIMITS = {
  maxFileSizeBytes: 50 * 1024 * 1024,
  maxPackageSizeBytes: 200 * 1024 * 1024,
  allowedExtensions: [
    SupportedUploadExtension.PDF,
    SupportedUploadExtension.DOCX,
    SupportedUploadExtension.XML,
  ],
} as const satisfies UploadLimits;

export const UploadValidationErrorCode = {
  FILE_SIZE_EXCEEDED: "file-size-exceeded",
  PACKAGE_SIZE_EXCEEDED: "package-size-exceeded",
  UNSUPPORTED_FORMAT: "unsupported-format",
} as const;

export type UploadValidationErrorCode =
  (typeof UploadValidationErrorCode)[keyof typeof UploadValidationErrorCode];

export interface UploadValidationError {
  code: UploadValidationErrorCode;
  fileName: string | null;
  message: string;
}

export interface UploadValidationResult {
  acceptedFiles: File[];
  errors: UploadValidationError[];
  pendingSizeBytes: number;
  acceptedSizeBytes: number;
  resultingPackageSizeBytes: number;
}

export const UploadRowOrigin = {
  LOCAL: "local",
  REMOTE: "remote",
} as const;

export type UploadRowOrigin =
  (typeof UploadRowOrigin)[keyof typeof UploadRowOrigin];

export const UploadRowStatus = {
  PENDING: "pending",
  UPLOADING: "uploading",
  REJECTED: "rejected",
  DUPLICATE: "duplicate",
  ACCEPTED: "accepted",
  QUEUED: "queued",
  PROCESSING: "processing",
  CLASSIFYING: "classifying",
  READY: "ready",
  NEEDS_REVIEW: "needs-review",
  FAILED: "failed",
} as const;

export type UploadRowStatus =
  (typeof UploadRowStatus)[keyof typeof UploadRowStatus];

export const UploadRetryKind = {
  PARSING: "parsing",
  CLASSIFICATION: "classification",
} as const;

export type UploadRetryKind =
  (typeof UploadRetryKind)[keyof typeof UploadRetryKind];

export interface PendingUploadFile {
  clientFileId: string;
  file: File;
  declaredStage: DocumentStage;
  acceptedFileId: string | null;
  outcome: PendingUploadOutcome | null;
}

export interface PendingUploadOutcome {
  duplicate: boolean;
  message: string;
  existingFileId: string | null;
}

export interface UploadRow {
  id: string;
  origin: UploadRowOrigin;
  name: string;
  extension: SupportedUploadExtension;
  sizeBytes: number;
  clientFileId: string | null;
  fileId: string | null;
  sha256: string | null;
  integrityError: boolean;
  pageCount: number | null;
  declaredStage: DocumentStage | null;
  detectedStage: DocumentStage | null;
  documentKind: string | null;
  stage: DocumentStage | null;
  stageMismatch: boolean;
  status: UploadRowStatus;
  statusDetail: string | null;
  needsReview: boolean;
  retryKind: UploadRetryKind | null;
  existingFileId: string | null;
}

export interface UploadSummary {
  totalFiles: number;
  totalKnownPages: number;
  totalSizeBytes: number;
  stageCounts: Record<DocumentStage, number>;
  readyCount: number;
  needsReviewCount: number;
  unclassifiedCount: number;
  pendingCount: number;
  failedCount: number;
}

export const UploadDocumentFilter = {
  ALL: "all",
  NEEDS_REVIEW: "needs-review",
  FAILED: "failed",
} as const;

export type UploadDocumentFilter =
  | (typeof UploadDocumentFilter)[keyof typeof UploadDocumentFilter]
  | DocumentStage;

export interface UploadDocumentFilterOptions {
  filter: UploadDocumentFilter;
  query: string;
}
