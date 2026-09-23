export const VERIFICATION_FIXTURE_SOURCE = "synthetic-demo" as const;
export const VERIFICATION_API_SOURCE = "api" as const;

export type VerificationSource =
  typeof VERIFICATION_FIXTURE_SOURCE | typeof VERIFICATION_API_SOURCE;

export const VerificationDocumentStage = {
  PD: "ПД",
  RD: "РД",
  ID: "ИД",
} as const;

export type VerificationDocumentStage =
  (typeof VerificationDocumentStage)[keyof typeof VerificationDocumentStage];

export const VerificationUiMarker = {
  IMPACT: "impact",
  ATTENTION: "attention",
  FORMALITY: "formality",
} as const;

export type VerificationUiMarker =
  (typeof VerificationUiMarker)[keyof typeof VerificationUiMarker];

export const FindingStatus = {
  CANDIDATE: "CANDIDATE",
  CONFIRMED_VIOLATION: "CONFIRMED_VIOLATION",
  NEGATIVE_VERIFIED: "NEGATIVE_VERIFIED",
  CLARIFICATION_REQUIRED: "CLARIFICATION_REQUIRED",
  MISSING_EVIDENCE: "MISSING_EVIDENCE",
  NOT_COMPARABLE: "NOT_COMPARABLE",
  NOT_APPLICABLE: "NOT_APPLICABLE",
} as const;

export type FindingStatus = (typeof FindingStatus)[keyof typeof FindingStatus];

export const ReviewPriority = {
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
} as const;

export type ReviewPriority =
  (typeof ReviewPriority)[keyof typeof ReviewPriority];

export const VerificationViewerSlotId = {
  LEFT: "left",
  RIGHT: "right",
} as const;

export type VerificationViewerSlotId =
  (typeof VerificationViewerSlotId)[keyof typeof VerificationViewerSlotId];

export const VerificationDocumentPreviewKind = {
  REQUIREMENTS: "requirements",
  DRAWING: "drawing",
  TABLE: "table",
  FALLBACK: "fallback",
} as const;

export type VerificationDocumentPreviewKind =
  (typeof VerificationDocumentPreviewKind)[keyof typeof VerificationDocumentPreviewKind];

export interface VerificationDocument {
  id: string;
  title: string;
  fileName: string;
  stage?: VerificationDocumentStage;
  cipher: string;
  revision: string;
  changeReference: string;
  approvalStatus: string;
  totalPages: number;
  previewKind: VerificationDocumentPreviewKind;
  heading: string;
  highlight: string;
  source: VerificationSource;
  isSynthetic: boolean;
}

export interface VerificationViewerSlot {
  id: VerificationViewerSlotId;
  label: string;
  availableDocumentIds: readonly string[];
  initialDocumentId: string;
  initialPage: number;
}

export interface VerificationEvidence {
  documentId: string;
  page: number;
  location: string;
  excerpt: string;
  value: string;
}

export interface VerificationFinding {
  id: string;
  ordinal: number;
  title: string;
  description: string;
  uiMarker: VerificationUiMarker;
  findingStatus: FindingStatus;
  reviewPriority: ReviewPriority;
  expectedEvidence: VerificationEvidence;
  actualEvidence: VerificationEvidence;
  consequences?: readonly string[];
  recommendation?: string;
  decisionReason: string | null;
  reviewComment: string | null;
  parameterCode?: string;
  verdictStatus?: string;
  /** row_version находки — оптимистичная блокировка решения через API. */
  findingVersion?: number;
  source: VerificationSource;
  isSynthetic: boolean;
}

export interface VerificationPackageFixture {
  id: string;
  title: string;
  objectId: string;
  objectLabel: string;
  sectionLabel: string;
  source: typeof VERIFICATION_FIXTURE_SOURCE;
  isSynthetic: true;
  fixtureNotice: string;
  documents: readonly VerificationDocument[];
  viewerSlots: readonly VerificationViewerSlot[];
  findings: readonly VerificationFinding[];
}

export interface VerificationSummary {
  totalCount: number;
  processedCount: number;
  pendingCount: number;
  processedPercent: number;
  markerCounts: Record<VerificationUiMarker, number>;
  statusCounts: Record<FindingStatus, number>;
  priorityCounts: Record<ReviewPriority, number>;
}

export interface VerificationFindingFilters {
  query: string;
  uiMarker: VerificationUiMarker | "all";
  findingStatus: FindingStatus | "all";
  reviewPriority: ReviewPriority | "all";
}

export const VerificationFindingSort = {
  ORDINAL: "ordinal",
  PRIORITY: "priority",
  STATUS: "status",
  MARKER: "marker",
  TITLE: "title",
} as const;

export type VerificationFindingSort =
  (typeof VerificationFindingSort)[keyof typeof VerificationFindingSort];

export type VerificationFindingDecision =
  | {
      findingStatus: typeof FindingStatus.NEGATIVE_VERIFIED;
      reason: string;
      comment: string;
    }
  | {
      findingStatus:
        | typeof FindingStatus.CONFIRMED_VIOLATION
        | typeof FindingStatus.CLARIFICATION_REQUIRED
        | typeof FindingStatus.CANDIDATE;
      comment: string;
    };
