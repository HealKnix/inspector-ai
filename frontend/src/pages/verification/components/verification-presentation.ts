import {
  FindingStatus,
  VerificationUiMarker,
  type VerificationFinding,
  type VerificationUiMarker as VerificationUiMarkerValue,
} from "@/pages/verification/types";

interface MarkerPresentation {
  badgeClassName: string;
  dotClassName: string;
  label: string;
}

export const markerPresentation: Record<
  VerificationUiMarkerValue,
  MarkerPresentation
> = {
  [VerificationUiMarker.IMPACT]: {
    badgeClassName: "bg-danger/10 text-danger",
    dotClassName: "bg-danger text-danger-foreground",
    label: "Влияет",
  },
  [VerificationUiMarker.ATTENTION]: {
    badgeClassName: "bg-warning/10 text-foreground",
    dotClassName: "bg-warning text-warning-foreground",
    label: "Внимание",
  },
  [VerificationUiMarker.FORMALITY]: {
    badgeClassName: "bg-surface-raised text-foreground",
    dotClassName: "bg-copy-muted text-background",
    label: "Формальность",
  },
};

/** Risk guides review order; it does not establish a violation. */
export function findingMarkerPresentation(
  finding: VerificationFinding,
): MarkerPresentation {
  if (finding.isSynthetic) return markerPresentation[finding.uiMarker];
  if (finding.findingStatus === FindingStatus.CONFIRMED_VIOLATION)
    return { ...markerPresentation.impact, label: "Нарушение" };
  const needsReview =
    finding.findingStatus === FindingStatus.CANDIDATE ||
    finding.findingStatus === FindingStatus.CLARIFICATION_REQUIRED;
  return {
    badgeClassName: "bg-surface-high text-copy-muted",
    dotClassName: needsReview
      ? "bg-warning/15 text-warning"
      : "bg-surface-high text-copy-muted",
    label:
      finding.reviewPriority === "HIGH"
        ? "Высокий приоритет"
        : finding.reviewPriority === "MEDIUM"
          ? "Средний приоритет"
          : "Обычный приоритет",
  };
}

export const statusLabels: Record<FindingStatus, string> = {
  [FindingStatus.CANDIDATE]: "Ожидает решения",
  [FindingStatus.CONFIRMED_VIOLATION]: "Подтверждено",
  [FindingStatus.NEGATIVE_VERIFIED]: "Отклонено",
  [FindingStatus.CLARIFICATION_REQUIRED]: "Нужно уточнение",
  [FindingStatus.MISSING_EVIDENCE]: "Нет доказательств",
  [FindingStatus.NOT_COMPARABLE]: "Не сопоставимо",
  [FindingStatus.NOT_APPLICABLE]: "Неприменимо",
};
