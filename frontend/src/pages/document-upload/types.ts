export const DocumentStage = {
  PD: "PD",
  RD: "RD",
  ID: "ID",
} as const;

export type DocumentStage = (typeof DocumentStage)[keyof typeof DocumentStage];

export const MetadataPresentationState = {
  READY: "ready",
  NEEDS_REVIEW: "needs-review",
} as const;

export type MetadataPresentationState =
  (typeof MetadataPresentationState)[keyof typeof MetadataPresentationState];

export const SupportedUploadExtension = {
  PDF: "pdf",
  DOCX: "docx",
  XML: "xml",
} as const;

export type SupportedUploadExtension =
  (typeof SupportedUploadExtension)[keyof typeof SupportedUploadExtension];

export const UploadDocumentSource = {
  LOCAL_BROWSER: "local-browser",
  SYNTHETIC_DEMO: "synthetic-demo",
} as const;

export type UploadDocumentSource =
  (typeof UploadDocumentSource)[keyof typeof UploadDocumentSource];

export interface UploadDocument {
  id: string;
  objectId: string;
  name: string;
  extension: SupportedUploadExtension;
  mimeType: string;
  sizeBytes: number;
  pageCount: number | null;
  stage: DocumentStage | null;
  section: string | null;
  cipher: string | null;
  revision: string | null;
  approvalStatus: string | null;
  approvalDate: string | null;
  sheetNumber: string | number | null;
  pageNumber: string | number | null;
  fileHash: string | null;
  predecessorRevisionReference: string | null;
  successorRevisionReference: string | null;
  metadataState: MetadataPresentationState;
  metadataNote: string | null;
  source: UploadDocumentSource;
  isSynthetic: boolean;
}

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

export interface UploadPackageFixture {
  id: string;
  objectId: string;
  title: string;
  source: typeof UploadDocumentSource.SYNTHETIC_DEMO;
  isSynthetic: true;
  fixtureNotice: string;
  documents: readonly UploadDocument[];
  uploadLimits: UploadLimits;
  expectedManifest: null;
  controlledParametersWithoutSources: number;
}

export interface UploadSummary {
  totalFiles: number;
  totalKnownPages: number;
  totalSizeBytes: number;
  stageCounts: Record<DocumentStage, number>;
  readyCount: number;
  needsReviewCount: number;
  unclassifiedCount: number;
}

export type UploadDocumentFilter =
  "all" | DocumentStage | typeof MetadataPresentationState.NEEDS_REVIEW;

export interface UploadDocumentFilterOptions {
  filter: UploadDocumentFilter;
  query: string;
}

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
  existingSizeBytes: number;
  acceptedSizeBytes: number;
  resultingPackageSizeBytes: number;
}
