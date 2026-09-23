import {
  FindingStatus,
  ReviewPriority,
  VERIFICATION_FIXTURE_SOURCE,
  VerificationDocumentStage,
  VerificationUiMarker,
} from "@/pages/verification/types";

import { getVerificationSummary } from "@/pages/verification/lib/verification";

import { mockVerificationPackage } from "./verification";

describe("mockVerificationPackage", () => {
  it("содержит ровно 47 уникальных синтетических расхождений", () => {
    const findingIds = mockVerificationPackage.findings.map(
      (finding) => finding.id,
    );

    expect(mockVerificationPackage.findings).toHaveLength(47);
    expect(new Set(findingIds)).toHaveLength(47);
    expect(
      mockVerificationPackage.findings.map(({ ordinal }) => ordinal),
    ).toEqual(Array.from({ length: 47 }, (_, index) => index + 1));
  });

  it("явно отделяет fixture от API и реальных результатов проверки", () => {
    expect(mockVerificationPackage.source).toBe(VERIFICATION_FIXTURE_SOURCE);
    expect(mockVerificationPackage.source).toBe("synthetic-demo");
    expect(mockVerificationPackage.isSynthetic).toBe(true);
    expect(mockVerificationPackage.fixtureNotice).toContain(
      "Синтетические данные",
    );
    expect(mockVerificationPackage.fixtureNotice).toContain(
      "не являются ответом API",
    );

    expect(mockVerificationPackage.documents).toSatisfy(
      (documents: typeof mockVerificationPackage.documents) =>
        documents.every(
          (document) =>
            document.source === VERIFICATION_FIXTURE_SOURCE &&
            document.isSynthetic,
        ),
    );
    expect(mockVerificationPackage.findings).toSatisfy(
      (findings: typeof mockVerificationPackage.findings) =>
        findings.every(
          (finding) =>
            finding.source === VERIFICATION_FIXTURE_SOURCE &&
            finding.isSynthetic,
        ),
    );
  });

  it("начинается с 18 обработанных записей и разделяет маркер, статус и приоритет", () => {
    expect(getVerificationSummary(mockVerificationPackage.findings)).toEqual({
      totalCount: 47,
      processedCount: 18,
      pendingCount: 29,
      processedPercent: 38,
      markerCounts: {
        [VerificationUiMarker.IMPACT]: 12,
        [VerificationUiMarker.ATTENTION]: 9,
        [VerificationUiMarker.FORMALITY]: 26,
      },
      statusCounts: {
        [FindingStatus.CANDIDATE]: 29,
        [FindingStatus.CONFIRMED_VIOLATION]: 6,
        [FindingStatus.NEGATIVE_VERIFIED]: 7,
        [FindingStatus.CLARIFICATION_REQUIRED]: 5,
        [FindingStatus.MISSING_EVIDENCE]: 0,
        [FindingStatus.NOT_COMPARABLE]: 0,
        [FindingStatus.NOT_APPLICABLE]: 0,
      },
      priorityCounts: {
        [ReviewPriority.HIGH]: 12,
        [ReviewPriority.MEDIUM]: 23,
        [ReviewPriority.LOW]: 12,
      },
    });
  });

  it("использует только подтверждённые статусы и приоритеты", () => {
    const allowedStatuses = new Set(Object.values(FindingStatus));
    const allowedPriorities = new Set(Object.values(ReviewPriority));

    expect(mockVerificationPackage.findings).toSatisfy(
      (findings: typeof mockVerificationPackage.findings) =>
        findings.every(
          (finding) =>
            allowedStatuses.has(finding.findingStatus) &&
            allowedPriorities.has(finding.reviewPriority),
        ),
    );
  });

  it("предоставляет ПД, РД и ИД отдельно для обоих viewer slots", () => {
    const documentsById = new Map(
      mockVerificationPackage.documents.map((document) => [
        document.id,
        document,
      ]),
    );

    expect(mockVerificationPackage.viewerSlots).toHaveLength(2);

    for (const slot of mockVerificationPackage.viewerSlots) {
      const stages = slot.availableDocumentIds.map(
        (documentId) => documentsById.get(documentId)?.stage,
      );

      expect(new Set(stages)).toEqual(
        new Set([
          VerificationDocumentStage.PD,
          VerificationDocumentStage.RD,
          VerificationDocumentStage.ID,
        ]),
      );
      expect(slot.availableDocumentIds).toContain(slot.initialDocumentId);
    }

    expect(mockVerificationPackage.documents).toSatisfy(
      (documents: typeof mockVerificationPackage.documents) =>
        documents.every(
          (document) =>
            document.approvalStatus.includes("синтетический") ||
            document.approvalStatus.includes("демонстрационной"),
        ),
    );
  });

  it("связывает оба доказательства каждого расхождения с документами fixture", () => {
    const documentIds = new Set<string>(
      mockVerificationPackage.documents.map((document) => document.id),
    );
    const [leftSlot, rightSlot] = mockVerificationPackage.viewerSlots;
    const expectedDocumentIds = new Set<string>(
      leftSlot?.availableDocumentIds ?? [],
    );
    const actualDocumentIds = new Set<string>(
      rightSlot?.availableDocumentIds ?? [],
    );

    expect(mockVerificationPackage.findings).toSatisfy(
      (findings: typeof mockVerificationPackage.findings) =>
        findings.every(
          (finding) =>
            documentIds.has(finding.expectedEvidence.documentId) &&
            documentIds.has(finding.actualEvidence.documentId) &&
            expectedDocumentIds.has(finding.expectedEvidence.documentId) &&
            actualDocumentIds.has(finding.actualEvidence.documentId),
        ),
    );
  });

  it("позволяет сопоставлять разные массивы в независимых окнах", () => {
    const firstFinding = mockVerificationPackage.findings[0];

    expect(firstFinding?.expectedEvidence.documentId).toBe(
      "synthetic-demo-reference-pd",
    );
    expect(firstFinding?.actualEvidence.documentId).toBe(
      "synthetic-demo-actual-rd",
    );
  });
});
