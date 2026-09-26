import type { ClassificationFile } from "@/api/types/classification";
import type { ObjectFile } from "@/api/types/objects";
import type { ParsingFile } from "@/api/types/parsing";

import {
  DocumentStage,
  INTERACTIVE_UPLOAD_LIMITS,
  UploadDocumentFilter,
  UploadRetryKind,
  UploadRowOrigin,
  UploadRowStatus,
  UploadValidationErrorCode,
} from "../types";
import {
  createPendingUploadFile,
  filterUploadRows,
  getUploadSummary,
  localUploadRow,
  remoteUploadRow,
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

function createObjectFile(overrides: Partial<ObjectFile> = {}): ObjectFile {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    object_id: "22222222-2222-4222-8222-222222222222",
    process_id: "33333333-3333-4333-8333-333333333333",
    run_id: "44444444-4444-4444-8444-444444444444",
    original_name: "Свод затрат.pdf",
    size: 2 * MEBIBYTE,
    format: "PDF",
    sha256: "a".repeat(64),
    created_at: "2026-05-20T10:00:00Z",
    integrity_error: false,
    ...overrides,
  };
}

function createParsingFile(overrides: Partial<ParsingFile> = {}): ParsingFile {
  return {
    file_id: "11111111-1111-4111-8111-111111111111",
    process_id: "33333333-3333-4333-8333-333333333333",
    run_id: "44444444-4444-4444-8444-444444444444",
    original_name: "Свод затрат.pdf",
    state: "succeeded",
    attempt: 1,
    pages_completed: 10,
    pages_total: 10,
    quality: "OK",
    reasons: [],
    error_code: null,
    can_retry: false,
    artifact_id: "55555555-5555-4555-8555-555555555555",
    ...overrides,
  };
}

function createClassificationFile(
  overrides: Partial<ClassificationFile> = {},
): ClassificationFile {
  return {
    file_id: "11111111-1111-4111-8111-111111111111",
    process_id: "33333333-3333-4333-8333-333333333333",
    run_id: "44444444-4444-4444-8444-444444444444",
    artifact_id: "55555555-5555-4555-8555-555555555555",
    original_name: "Свод затрат.pdf",
    task_id: null,
    state: "succeeded",
    can_retry: false,
    error_code: null,
    result: {
      schema_version: 1,
      stage: DocumentStage.PD,
      document_kind: null,
      method: "rules",
      needs_review: false,
      reasons: [],
      evidence: [],
      candidates: [],
      versions: {
        classifier: "v1",
        rules: "v1",
        context: "v1",
        prompt: "v1",
        model: null,
      },
    },
    ...overrides,
  };
}

describe("createPendingUploadFile", () => {
  it("создаёт файл пакета с заявленной стадией", () => {
    const file = createFile("Новый_том.DOCX", 3 * MEBIBYTE);

    const pending = createPendingUploadFile(file, DocumentStage.RD);

    expect(pending.file).toBe(file);
    expect(pending.declaredStage).toBe(DocumentStage.RD);
    expect(pending.acceptedFileId).toBeNull();
    expect(pending.outcome).toBeNull();
    expect(pending.clientFileId).not.toBe("");
  });

  it("создаёт разные clientFileId для повторного добавления", () => {
    const file = createFile("Повторный_том.pdf", 3 * MEBIBYTE);

    const first = createPendingUploadFile(file, DocumentStage.PD);
    const second = createPendingUploadFile(file, DocumentStage.PD);

    expect(first.clientFileId).not.toBe(second.clientFileId);
  });

  it("не создаёт файл неподдерживаемого формата", () => {
    const file = createFile("Модель.dwg", MEBIBYTE);

    expect(() => createPendingUploadFile(file, DocumentStage.PD)).toThrow(
      "Неподдерживаемый формат",
    );
  });
});

describe("localUploadRow", () => {
  it("маппит файл пакета со статусом «в пакете»", () => {
    const pending = createPendingUploadFile(
      createFile("Том.pdf", 2 * MEBIBYTE),
      DocumentStage.PD,
    );

    const row = localUploadRow(pending, false);

    expect(row).toMatchObject({
      id: pending.clientFileId,
      origin: UploadRowOrigin.LOCAL,
      name: "Том.pdf",
      extension: "pdf",
      sizeBytes: 2 * MEBIBYTE,
      fileId: null,
      declaredStage: DocumentStage.PD,
      detectedStage: null,
      stage: DocumentStage.PD,
      stageMismatch: false,
      status: UploadRowStatus.PENDING,
      needsReview: false,
      retryKind: null,
    });
  });

  it("показывает «передача» во время отправки и «принят» после приёма", () => {
    const pending = createPendingUploadFile(
      createFile("Том.pdf", 2 * MEBIBYTE),
      DocumentStage.PD,
    );

    expect(localUploadRow(pending, true).status).toBe(
      UploadRowStatus.UPLOADING,
    );
    expect(
      localUploadRow({ ...pending, acceptedFileId: "file-1" }, false).status,
    ).toBe(UploadRowStatus.ACCEPTED);
  });

  it("маппит отказ и дубликат из результата приёма", () => {
    const pending = createPendingUploadFile(
      createFile("Том.pdf", 2 * MEBIBYTE),
      DocumentStage.PD,
    );

    const rejected = localUploadRow(
      {
        ...pending,
        outcome: {
          duplicate: false,
          message: "Файл заражён",
          existingFileId: null,
        },
      },
      false,
    );
    const duplicate = localUploadRow(
      {
        ...pending,
        outcome: {
          duplicate: true,
          message: "Уже загружен",
          existingFileId: "file-9",
        },
      },
      false,
    );

    expect(rejected.status).toBe(UploadRowStatus.REJECTED);
    expect(rejected.statusDetail).toBe("Файл заражён");
    expect(duplicate.status).toBe(UploadRowStatus.DUPLICATE);
    expect(duplicate.existingFileId).toBe("file-9");
  });
});

describe("remoteUploadRow", () => {
  const review = {
    document_id: "66666666-6666-4666-8666-666666666666",
    revision_id: "77777777-7777-4777-8777-777777777777",
    card_version: 2,
    resolved_input_hash: "a".repeat(64),
    fields: { stage: "RD", code: "Синтетический шифр", revision_label: "2" },
    confirmed_fields: ["stage"],
    needs_review: false,
    reasons: [],
    source_issues: [],
  };
  it("uses the confirmed current metadata instead of a legacy review flag", () => {
    const classification = createClassificationFile();
    const row = remoteUploadRow(
      createObjectFile(),
      createParsingFile(),
      {
        ...classification,
        result: {
          ...classification.result!,
          needs_review: true,
          reasons: ["own_stage_cell"],
        },
        review,
      },
      null,
    );
    expect(row).toMatchObject({
      status: UploadRowStatus.READY,
      reviewed: true,
      needsReview: false,
      stage: "RD",
      documentCode: "Синтетический шифр",
      revisionLabel: "2",
      statusDetail: null,
    });
  });
  it("keeps source limitations actionable after metadata confirmation without leaking codes", () => {
    const row = remoteUploadRow(
      createObjectFile(),
      createParsingFile(),
      createClassificationFile({
        review: { ...review, source_issues: ["partial_parse_requires_review"] },
      }),
      null,
    );
    expect(row).toMatchObject({
      needsReview: true,
      sourceIssue: true,
      status: UploadRowStatus.NEEDS_REVIEW,
      statusDetail: "Часть файла не прочитана. Проверьте оригинал.",
    });
  });
  it.each(["run_id", "artifact_id"] as const)(
    "ignores a confirmed result with a stale %s",
    (field) => {
      const row = remoteUploadRow(
        createObjectFile(),
        createParsingFile(),
        createClassificationFile({
          review,
          [field]: "88888888-8888-4888-8888-888888888888",
        }),
        null,
      );
      expect(row).toMatchObject({
        status: UploadRowStatus.CLASSIFYING,
        reviewed: false,
        documentCode: null,
      });
    },
  );
  it("маппит файл без обработки как «принят»", () => {
    const row = remoteUploadRow(createObjectFile(), undefined, undefined, null);

    expect(row).toMatchObject({
      origin: UploadRowOrigin.REMOTE,
      extension: "pdf",
      status: UploadRowStatus.ACCEPTED,
      stage: null,
      pageCount: null,
    });
  });

  it("маппит очередь и прогресс обработки", () => {
    const file = createObjectFile();

    expect(
      remoteUploadRow(
        file,
        createParsingFile({ state: "queued" }),
        undefined,
        null,
      ).status,
    ).toBe(UploadRowStatus.QUEUED);

    const processing = remoteUploadRow(
      file,
      createParsingFile({
        state: "processing",
        pages_completed: 3,
        pages_total: 8,
      }),
      undefined,
      null,
    );
    expect(processing.status).toBe(UploadRowStatus.PROCESSING);
    expect(processing.statusDetail).toBe("3 / 8 стр.");
    expect(processing.pageCount).toBe(8);
  });

  it("маппит ошибку обработки с возможностью повтора", () => {
    const row = remoteUploadRow(
      createObjectFile(),
      createParsingFile({
        state: "failed",
        error_code: "ocr_failed",
        can_retry: true,
      }),
      undefined,
      null,
    );

    expect(row.status).toBe(UploadRowStatus.FAILED);
    expect(row.statusDetail).toBe(
      "Не удалось прочитать файл. Повторите обработку.",
    );
    expect(row.retryKind).toBe(UploadRetryKind.PARSING);
  });

  it("маппит классификацию: готов, уточнение, ошибка", () => {
    const file = createObjectFile();
    const parsing = createParsingFile();

    const ready = remoteUploadRow(
      file,
      parsing,
      createClassificationFile(),
      null,
    );
    expect(ready.status).toBe(UploadRowStatus.READY);
    expect(ready.stage).toBe(DocumentStage.PD);

    const needsReview = remoteUploadRow(
      file,
      parsing,
      createClassificationFile({
        result: {
          ...createClassificationFile().result!,
          needs_review: true,
          reasons: ["Низкая уверенность"],
        },
      }),
      null,
    );
    expect(needsReview.status).toBe(UploadRowStatus.NEEDS_REVIEW);
    expect(needsReview.needsReview).toBe(true);
    expect(needsReview.statusDetail).toBe(
      "Подтвердите сведения в карточке документа.",
    );

    const failed = remoteUploadRow(
      file,
      parsing,
      createClassificationFile({
        state: "failed",
        result: null,
        error_code: "llm_unavailable",
        can_retry: true,
      }),
      null,
    );
    expect(failed.status).toBe(UploadRowStatus.FAILED);
    expect(failed.retryKind).toBe(UploadRetryKind.CLASSIFICATION);

    const classifying = remoteUploadRow(
      file,
      parsing,
      createClassificationFile({ state: "processing", result: null }),
      null,
    );
    expect(classifying.status).toBe(UploadRowStatus.CLASSIFYING);
  });

  it("использует заявленную стадию до классификации и помечает расхождение", () => {
    const file = createObjectFile();
    const parsing = createParsingFile();

    const declaredOnly = remoteUploadRow(
      file,
      parsing,
      undefined,
      DocumentStage.ID,
    );
    expect(declaredOnly.stage).toBe(DocumentStage.ID);
    expect(declaredOnly.stageMismatch).toBe(false);

    const mismatch = remoteUploadRow(
      file,
      parsing,
      createClassificationFile({
        result: {
          ...createClassificationFile().result!,
          stage: DocumentStage.RD,
        },
      }),
      DocumentStage.PD,
    );
    expect(mismatch.stage).toBe(DocumentStage.RD);
    expect(mismatch.declaredStage).toBe(DocumentStage.PD);
    expect(mismatch.detectedStage).toBe(DocumentStage.RD);
    expect(mismatch.stageMismatch).toBe(true);

    const matching = remoteUploadRow(
      file,
      parsing,
      createClassificationFile(),
      DocumentStage.PD,
    );
    expect(matching.stageMismatch).toBe(false);
  });

  it("маппит нарушение целостности как ошибку", () => {
    const row = remoteUploadRow(
      createObjectFile({ integrity_error: true }),
      undefined,
      undefined,
      null,
    );

    expect(row.status).toBe(UploadRowStatus.FAILED);
    expect(row.integrityError).toBe(true);
  });
});

describe("getUploadSummary", () => {
  it("считает файлы, страницы, стадии и состояния", () => {
    const pending = createPendingUploadFile(
      createFile("Пакет.pdf", MEBIBYTE),
      DocumentStage.PD,
    );
    const rows = [
      localUploadRow(pending, false),
      remoteUploadRow(
        createObjectFile({ id: "a" }),
        createParsingFile({ pages_total: 10 }),
        createClassificationFile(),
        null,
      ),
      remoteUploadRow(
        createObjectFile({ id: "b" }),
        createParsingFile({ pages_total: 5 }),
        createClassificationFile({
          result: {
            ...createClassificationFile().result!,
            stage: DocumentStage.RD,
            needs_review: true,
          },
        }),
        null,
      ),
      remoteUploadRow(
        createObjectFile({ id: "c" }),
        undefined,
        undefined,
        null,
      ),
    ];

    expect(getUploadSummary(rows)).toEqual({
      totalFiles: 4,
      totalKnownPages: 15,
      totalSizeBytes: 7 * MEBIBYTE,
      stageCounts: { PD: 2, RD: 1, ID: 0 },
      readyCount: 1,
      needsReviewCount: 1,
      unclassifiedCount: 1,
      pendingCount: 1,
      failedCount: 0,
    });
  });

  it("возвращает нулевую сводку для пустого комплекта", () => {
    expect(getUploadSummary([])).toEqual({
      totalFiles: 0,
      totalKnownPages: 0,
      totalSizeBytes: 0,
      stageCounts: { PD: 0, RD: 0, ID: 0 },
      readyCount: 0,
      needsReviewCount: 0,
      unclassifiedCount: 0,
      pendingCount: 0,
      failedCount: 0,
    });
  });
});

describe("filterUploadRows", () => {
  const pending = createPendingUploadFile(
    createFile("Пакет ПД.pdf", MEBIBYTE),
    DocumentStage.PD,
  );
  const rows = [
    localUploadRow(pending, false),
    remoteUploadRow(
      createObjectFile({ id: "a", original_name: "Лист РД.pdf" }),
      createParsingFile(),
      createClassificationFile({
        result: {
          ...createClassificationFile().result!,
          stage: DocumentStage.RD,
        },
      }),
      null,
    ),
    remoteUploadRow(
      createObjectFile({ id: "b", original_name: "Акт ИД.pdf" }),
      createParsingFile(),
      createClassificationFile({
        result: {
          ...createClassificationFile().result!,
          stage: DocumentStage.ID,
          needs_review: true,
        },
      }),
      null,
    ),
    remoteUploadRow(
      createObjectFile({ id: "c", original_name: "Битый.pdf" }),
      createParsingFile({ state: "failed", can_retry: true }),
      undefined,
      null,
    ),
  ];

  it("фильтрует по стадии, уточнению и ошибкам", () => {
    expect(
      filterUploadRows(rows, { filter: DocumentStage.PD, query: "" }),
    ).toHaveLength(1);
    expect(
      filterUploadRows(rows, { filter: DocumentStage.RD, query: "" }),
    ).toHaveLength(1);
    expect(
      filterUploadRows(rows, {
        filter: UploadDocumentFilter.NEEDS_REVIEW,
        query: "",
      }),
    ).toHaveLength(1);
    expect(
      filterUploadRows(rows, {
        filter: UploadDocumentFilter.FAILED,
        query: "",
      }),
    ).toHaveLength(1);
    expect(
      filterUploadRows(rows, { filter: UploadDocumentFilter.ALL, query: "" }),
    ).toHaveLength(4);
  });

  it("ищет без учёта регистра по имени и метаданным", () => {
    expect(
      filterUploadRows(rows, { filter: "all", query: "  АКТ  " }).map(
        (row) => row.id,
      ),
    ).toEqual(["b"]);
    expect(
      filterUploadRows(rows, { filter: "all", query: "a".repeat(20) }),
    ).toHaveLength(3);
    expect(
      filterUploadRows(rows, { filter: DocumentStage.ID, query: "лист" }),
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

    const result = validateUploadFiles(0, files);

    expect(result.acceptedFiles).toEqual(files);
    expect(result.errors).toEqual([]);
    expect(result.resultingPackageSizeBytes).toBe(53 * MEBIBYTE);
  });

  it("отклоняет неподдерживаемые и слишком большие файлы", () => {
    const validFile = createFile("план.pdf", 2 * MEBIBYTE);
    const unsupportedFile = createFile("чертёж.dwg", MEBIBYTE);
    const oversizedFile = createFile("том.pdf", 50 * MEBIBYTE + 1);

    const result = validateUploadFiles(
      0,
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

    const result = validateUploadFiles(150 * MEBIBYTE, files);

    expect(result.acceptedFiles).toEqual([]);
    expect(result.acceptedSizeBytes).toBe(0);
    expect(result.resultingPackageSizeBytes).toBe(150 * MEBIBYTE);
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

    const result = validateUploadFiles(145.5 * MEBIBYTE, files);

    expect(result.acceptedFiles).toEqual(files);
    expect(result.errors).toEqual([]);
    expect(result.resultingPackageSizeBytes).toBe(200 * MEBIBYTE);
  });
});
