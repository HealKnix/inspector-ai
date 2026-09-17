import { mockUploadPackage } from "@/data/document-upload";

import {
  DocumentStage,
  INTERACTIVE_UPLOAD_LIMITS,
  MetadataPresentationState,
  SupportedUploadExtension,
  UploadDocumentSource,
  UploadValidationErrorCode,
} from "../types";
import {
  createLocalUploadDocument,
  filterUploadDocuments,
  getUploadSummary,
  validateUploadFiles,
} from "./document-upload";

const MEBIBYTE = 1024 * 1024;

function createFile(name: string, sizeBytes: number, type = ""): File {
  const file = new File(["fixture"], name, { lastModified: 1, type });
  Object.defineProperty(file, "size", {
    configurable: true,
    value: sizeBytes,
  });
  return file;
}

describe("getUploadSummary", () => {
  it("считает файлы, известные страницы, стадии и состояния метаданных", () => {
    expect(getUploadSummary(mockUploadPackage.documents)).toEqual({
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

  it("возвращает нулевую сводку для пустого комплекта", () => {
    expect(getUploadSummary([])).toEqual({
      totalFiles: 0,
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
    });
  });
});

describe("filterUploadDocuments", () => {
  it("фильтрует документы по стадии и состоянию проверки", () => {
    expect(
      filterUploadDocuments(mockUploadPackage.documents, {
        filter: DocumentStage.ID,
        query: "",
      }),
    ).toHaveLength(4);

    expect(
      filterUploadDocuments(mockUploadPackage.documents, {
        filter: MetadataPresentationState.NEEDS_REVIEW,
        query: "",
      }),
    ).toHaveLength(4);
  });

  it("ищет без учёта регистра по имени и метаданным", () => {
    const byName = filterUploadDocuments(mockUploadPackage.documents, {
      filter: "all",
      query: "  БЕТОННЫХ  ",
    });
    const byCipher = filterUploadDocuments(mockUploadPackage.documents, {
      filter: DocumentStage.PD,
      query: "пд-спзу",
    });

    expect(byName.map((document) => document.id)).toEqual(["demo-id-002"]);
    expect(byCipher.map((document) => document.id)).toEqual(["demo-pd-002"]);
  });

  it("ищет по расширенным строковым и числовым метаданным", () => {
    const byApprovalStatus = filterUploadDocuments(
      mockUploadPackage.documents,
      {
        filter: "all",
        query: "УТВЕРЖДЁН (ДЕМО)",
      },
    );
    const bySheetNumber = filterUploadDocuments(mockUploadPackage.documents, {
      filter: "all",
      query: "спзу-02",
    });
    const byHash = filterUploadDocuments(mockUploadPackage.documents, {
      filter: "all",
      query: "demo-hash:demo-id-002",
    });
    const byRevisionReference = filterUploadDocuments(
      mockUploadPackage.documents,
      {
        filter: "all",
        query: "demo-rd-004-revision-r2",
      },
    );

    expect(byApprovalStatus).toHaveLength(21);
    expect(bySheetNumber.map((document) => document.id)).toEqual([
      "demo-pd-002",
    ]);
    expect(byHash.map((document) => document.id)).toEqual(["demo-id-002"]);
    expect(byRevisionReference.map((document) => document.id)).toEqual([
      "demo-rd-004",
    ]);
  });

  it("совмещает текстовый поиск с выбранным фильтром", () => {
    expect(
      filterUploadDocuments(mockUploadPackage.documents, {
        filter: DocumentStage.RD,
        query: "исполнительная",
      }),
    ).toEqual([]);
  });
});

describe("validateUploadFiles", () => {
  it("принимает поддерживаемые форматы с размером до 50 МБ включительно", () => {
    const files = [
      createFile("План.PDF", 50 * MEBIBYTE, "application/pdf"),
      createFile("Спецификация.docx", 2 * MEBIBYTE),
      createFile("Реестр.xml", 1 * MEBIBYTE),
    ];

    const result = validateUploadFiles([], files);

    expect(result.acceptedFiles).toEqual(files);
    expect(result.errors).toEqual([]);
    expect(result.resultingPackageSizeBytes).toBe(53 * MEBIBYTE);
  });

  it("отклоняет неподдерживаемые и слишком большие файлы", () => {
    const validFile = createFile("план.pdf", 2 * MEBIBYTE);
    const unsupportedFile = createFile("чертёж.dwg", MEBIBYTE);
    const oversizedFile = createFile("том.pdf", 50 * MEBIBYTE + 1);

    const result = validateUploadFiles(
      [],
      [validFile, unsupportedFile, oversizedFile],
      INTERACTIVE_UPLOAD_LIMITS,
    );

    expect(result.acceptedFiles).toEqual([validFile]);
    expect(result.errors.map((error) => error.code)).toEqual([
      UploadValidationErrorCode.UNSUPPORTED_FORMAT,
      UploadValidationErrorCode.FILE_SIZE_EXCEEDED,
    ]);
    expect(result.errors.every((error) => error.message.length > 0)).toBe(true);
  });

  it("отклоняет весь выбранный пакет при превышении общего лимита", () => {
    const files = [
      createFile("том-1.pdf", 50 * MEBIBYTE),
      createFile("том-2.pdf", 5 * MEBIBYTE),
    ];

    const result = validateUploadFiles(mockUploadPackage.documents, files);

    expect(result.acceptedFiles).toEqual([]);
    expect(result.acceptedSizeBytes).toBe(0);
    expect(result.resultingPackageSizeBytes).toBe(145.5 * MEBIBYTE);
    expect(result.errors.at(-1)).toMatchObject({
      code: UploadValidationErrorCode.PACKAGE_SIZE_EXCEEDED,
      fileName: null,
    });
  });

  it("разрешает пакет ровно на границе 200 МБ", () => {
    const files = [
      createFile("том-1.pdf", 50 * MEBIBYTE),
      createFile("том-2.xml", 4.5 * MEBIBYTE),
    ];

    const result = validateUploadFiles(mockUploadPackage.documents, files);

    expect(result.acceptedFiles).toEqual(files);
    expect(result.errors).toEqual([]);
    expect(result.resultingPackageSizeBytes).toBe(200 * MEBIBYTE);
  });
});

describe("createLocalUploadDocument", () => {
  it("создаёт локальный документ без выдуманных метаданных", () => {
    const file = createFile("Новый_том.DOCX", 3 * MEBIBYTE);

    const document = createLocalUploadDocument(file, "OBJECT-42");

    expect(document).toMatchObject({
      objectId: "OBJECT-42",
      name: "Новый_том.DOCX",
      extension: SupportedUploadExtension.DOCX,
      sizeBytes: 3 * MEBIBYTE,
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
      source: UploadDocumentSource.LOCAL_BROWSER,
      isSynthetic: false,
    });
  });

  it("создаёт разные id для двух добавлений одного и того же File", () => {
    const file = createFile("Повторный_том.pdf", 3 * MEBIBYTE);

    const firstDocument = createLocalUploadDocument(file, "OBJECT-42");
    const secondDocument = createLocalUploadDocument(file, "OBJECT-42");

    expect(firstDocument.id).not.toBe(secondDocument.id);
  });

  it("не создаёт документ неподдерживаемого формата", () => {
    const file = createFile("Модель.dwg", MEBIBYTE);

    expect(() => createLocalUploadDocument(file, "OBJECT-42")).toThrow(
      "Неподдерживаемый формат",
    );
  });
});
