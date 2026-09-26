import {
  FindingStatus,
  ReviewPriority,
  VerificationUiMarker,
  type VerificationDocument,
  type VerificationFinding,
  type VerificationFindingDecision,
  type VerificationFindingFilters,
  type VerificationFindingSort,
  type VerificationSummary,
} from "../types";

const priorityOrder: Record<ReviewPriority, number> = {
  [ReviewPriority.HIGH]: 0,
  [ReviewPriority.MEDIUM]: 1,
  [ReviewPriority.LOW]: 2,
};

const statusOrder: Record<FindingStatus, number> = {
  [FindingStatus.CANDIDATE]: 0,
  [FindingStatus.CLARIFICATION_REQUIRED]: 1,
  [FindingStatus.CONFIRMED_VIOLATION]: 2,
  [FindingStatus.NEGATIVE_VERIFIED]: 3,
  [FindingStatus.MISSING_EVIDENCE]: 4,
  [FindingStatus.NOT_COMPARABLE]: 5,
  [FindingStatus.NOT_APPLICABLE]: 6,
};

const markerOrder: Record<VerificationUiMarker, number> = {
  [VerificationUiMarker.IMPACT]: 0,
  [VerificationUiMarker.ATTENTION]: 1,
  [VerificationUiMarker.FORMALITY]: 2,
};

function isProcessed(finding: VerificationFinding): boolean {
  return finding.findingStatus !== FindingStatus.CANDIDATE;
}

function compareByOrdinal(
  first: VerificationFinding,
  second: VerificationFinding,
): number {
  return first.ordinal - second.ordinal;
}

export function searchVerificationFindings(
  findings: readonly VerificationFinding[],
  query: string,
  documents: readonly VerificationDocument[] = [],
): VerificationFinding[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");

  if (normalizedQuery.length === 0) {
    return [...findings];
  }

  const documentsById = new Map(
    documents.map((document) => [document.id, document]),
  );

  return findings.filter((finding) => {
    const expectedDocument = documentsById.get(
      finding.expectedEvidence.documentId,
    );
    const actualDocument = documentsById.get(finding.actualEvidence.documentId);

    return [
      finding.id,
      finding.title,
      finding.description,
      finding.contextLabel,
      finding.expectedEvidence.location,
      finding.expectedEvidence.excerpt,
      finding.expectedEvidence.value,
      finding.actualEvidence.location,
      finding.actualEvidence.excerpt,
      finding.actualEvidence.value,
      finding.recommendation,
      finding.decisionReason,
      finding.reviewComment,
      expectedDocument?.title,
      expectedDocument?.fileName,
      expectedDocument?.cipher,
      expectedDocument?.revision,
      expectedDocument?.changeReference,
      actualDocument?.title,
      actualDocument?.fileName,
      actualDocument?.cipher,
      actualDocument?.revision,
      actualDocument?.changeReference,
    ].some(
      (value) =>
        value != null &&
        value.toLocaleLowerCase("ru-RU").includes(normalizedQuery),
    );
  });
}

export function filterVerificationFindings(
  findings: readonly VerificationFinding[],
  filters: VerificationFindingFilters,
  documents: readonly VerificationDocument[] = [],
): VerificationFinding[] {
  return searchVerificationFindings(findings, filters.query, documents).filter(
    (finding) =>
      (filters.uiMarker === "all" || finding.uiMarker === filters.uiMarker) &&
      (filters.findingStatus === "all" ||
        finding.findingStatus === filters.findingStatus) &&
      (filters.reviewPriority === "all" ||
        finding.reviewPriority === filters.reviewPriority),
  );
}

export function sortVerificationFindings(
  findings: readonly VerificationFinding[],
  sortBy: VerificationFindingSort,
): VerificationFinding[] {
  return [...findings].sort((first, second) => {
    let result = 0;

    if (sortBy === "priority") {
      result =
        priorityOrder[first.reviewPriority] -
        priorityOrder[second.reviewPriority];
    } else if (sortBy === "status") {
      result =
        statusOrder[first.findingStatus] - statusOrder[second.findingStatus];
    } else if (sortBy === "marker") {
      result = markerOrder[first.uiMarker] - markerOrder[second.uiMarker];
    } else if (sortBy === "title") {
      result = first.title.localeCompare(second.title, "ru-RU");
    }

    return result || compareByOrdinal(first, second);
  });
}

export function getVerificationSummary(
  findings: readonly VerificationFinding[],
): VerificationSummary {
  const summary: VerificationSummary = {
    totalCount: findings.length,
    processedCount: 0,
    pendingCount: 0,
    processedPercent: 0,
    markerCounts: {
      [VerificationUiMarker.IMPACT]: 0,
      [VerificationUiMarker.ATTENTION]: 0,
      [VerificationUiMarker.FORMALITY]: 0,
    },
    statusCounts: {
      [FindingStatus.CANDIDATE]: 0,
      [FindingStatus.CONFIRMED_VIOLATION]: 0,
      [FindingStatus.NEGATIVE_VERIFIED]: 0,
      [FindingStatus.CLARIFICATION_REQUIRED]: 0,
      [FindingStatus.MISSING_EVIDENCE]: 0,
      [FindingStatus.NOT_COMPARABLE]: 0,
      [FindingStatus.NOT_APPLICABLE]: 0,
    },
    priorityCounts: {
      [ReviewPriority.HIGH]: 0,
      [ReviewPriority.MEDIUM]: 0,
      [ReviewPriority.LOW]: 0,
    },
  };

  for (const finding of findings) {
    summary.markerCounts[finding.uiMarker] += 1;
    summary.statusCounts[finding.findingStatus] += 1;
    summary.priorityCounts[finding.reviewPriority] += 1;

    if (isProcessed(finding)) {
      summary.processedCount += 1;
    }
  }

  summary.pendingCount = summary.totalCount - summary.processedCount;
  summary.processedPercent =
    summary.totalCount === 0
      ? 0
      : Math.round((summary.processedCount / summary.totalCount) * 100);

  return summary;
}

function requireComment(comment: string): string {
  const normalizedComment = comment.trim();

  if (normalizedComment.length === 0) {
    throw new Error("Для решения нужен комментарий.");
  }

  return normalizedComment;
}

export function applyLocalFindingDecision(
  findings: readonly VerificationFinding[],
  findingId: string,
  decision: VerificationFindingDecision,
): VerificationFinding[] {
  const findingIndex = findings.findIndex(
    (finding) => finding.id === findingId,
  );

  if (findingIndex < 0) {
    throw new Error(`Расхождение «${findingId}» не найдено.`);
  }

  const comment = requireComment(decision.comment);
  let reason: string | null = null;

  if (decision.findingStatus === FindingStatus.NEGATIVE_VERIFIED) {
    reason = decision.reason.trim();

    if (reason.length === 0) {
      throw new Error("Для отклонения необходимо указать причину.");
    }
  }

  return findings.map((finding, index) =>
    index === findingIndex
      ? {
          ...finding,
          findingStatus: decision.findingStatus,
          // reopen сохраняет прошлую причину — она подставится при повторном
          // отклонении; confirm очищает её как не относящуюся к решению.
          decisionReason:
            decision.findingStatus === FindingStatus.NEGATIVE_VERIFIED
              ? reason
              : decision.findingStatus === FindingStatus.CANDIDATE
                ? finding.decisionReason
                : null,
          reviewComment: comment,
        }
      : finding,
  );
}
