import { mockUploadPackage } from "./document-upload";

import { getUploadSummary } from "@/pages/document-upload/lib/document-upload";
import {
  DocumentStage,
  INTERACTIVE_UPLOAD_LIMITS,
  MetadataPresentationState,
  UploadDocumentSource,
} from "@/pages/document-upload/types";

const MEBIBYTE = 1024 * 1024;

describe("mockUploadPackage", () => {
  it("содержит согласованный синтетический комплект", () => {
    const summary = getUploadSummary(mockUploadPackage.documents);

    expect(summary).toEqual({
      totalFiles: 22,
      totalKnownPages: 1842,
      totalSizeBytes: 145.5 * MEBIBYTE,
      stageCounts: {
        [DocumentStage.PD]: 8,
        [DocumentStage.RD]: 10,
        [DocumentStage.ID]: 4,
      },
      readyCount: 18,
      needsReviewCount: 4,
      unclassifiedCount: 0,
    });
  });

  it("явно отделяет демонстрационные данные от API-контракта", () => {
    expect(mockUploadPackage.isSynthetic).toBe(true);
    expect(mockUploadPackage.source).toBe(UploadDocumentSource.SYNTHETIC_DEMO);
    expect(mockUploadPackage.fixtureNotice).toContain("Синтетические данные");
    expect(mockUploadPackage.expectedManifest).toBeNull();
    expect(mockUploadPackage.controlledParametersWithoutSources).toBe(6);

    expect(mockUploadPackage.documents).toSatisfy(
      (documents: readonly (typeof mockUploadPackage.documents)[number][]) =>
        documents.every(
          (document) =>
            document.isSynthetic &&
            document.source === UploadDocumentSource.SYNTHETIC_DEMO,
        ),
    );
  });

  it("содержит расширенные синтетические метаданные без договорённости об enum", () => {
    const documentWithRevisionLinks = mockUploadPackage.documents.find(
      (document) => document.id === "demo-rd-004",
    );

    expect(mockUploadPackage.documents).toSatisfy(
      (documents: readonly (typeof mockUploadPackage.documents)[number][]) =>
        documents.every(
          (document) =>
            typeof document.fileHash === "string" &&
            document.fileHash.startsWith("demo-hash:") &&
            (document.approvalStatus === null ||
              typeof document.approvalStatus === "string") &&
            (document.approvalDate === null ||
              typeof document.approvalDate === "string") &&
            (document.sheetNumber === null ||
              typeof document.sheetNumber === "string" ||
              typeof document.sheetNumber === "number") &&
            (document.pageNumber === null ||
              typeof document.pageNumber === "string" ||
              typeof document.pageNumber === "number"),
        ),
    );
    expect(documentWithRevisionLinks).toMatchObject({
      approvalStatus: null,
      approvalDate: null,
      predecessorRevisionReference: "demo-rd-004-revision-r1",
      successorRevisionReference: "demo-rd-004-revision-r2",
    });
  });

  it("использует подтверждённые ограничения интерактивной загрузки", () => {
    expect(mockUploadPackage.uploadLimits).toBe(INTERACTIVE_UPLOAD_LIMITS);
    expect(mockUploadPackage.uploadLimits.maxFileSizeBytes).toBe(50 * MEBIBYTE);
    expect(mockUploadPackage.uploadLimits.maxPackageSizeBytes).toBe(
      200 * MEBIBYTE,
    );

    expect(mockUploadPackage.documents).toSatisfy(
      (documents: readonly (typeof mockUploadPackage.documents)[number][]) =>
        documents.every(
          (document) =>
            document.sizeBytes <=
              mockUploadPackage.uploadLimits.maxFileSizeBytes &&
            mockUploadPackage.uploadLimits.allowedExtensions.includes(
              document.extension,
            ),
        ),
    );
  });

  it("помечает ровно четыре документа для проверки метаданных", () => {
    const reviewDocuments = mockUploadPackage.documents.filter(
      (document) =>
        document.metadataState === MetadataPresentationState.NEEDS_REVIEW,
    );

    expect(reviewDocuments).toHaveLength(4);
    expect(reviewDocuments.every((document) => document.metadataNote)).toBe(
      true,
    );
  });
});
