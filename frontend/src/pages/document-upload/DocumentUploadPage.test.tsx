import { getExtractions } from "@/api/endpoints/extraction";
import { getIdentification } from "@/api/endpoints/identification";
import { generateProtocol } from "@/api/endpoints/verification";
import { idRegistry } from "@/pages/identification/lib/identification-test-fixtures";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import {
  getClassificationStatus,
  getKindOptions,
} from "@/api/endpoints/classification";
import {
  getCompletenessResult,
  getExpectedPackage,
} from "@/api/endpoints/completeness";
import {
  getObject,
  getReceipt,
  listFiles,
  uploadDocuments,
} from "@/api/endpoints/objects";
import { getParsingStatus } from "@/api/endpoints/parsing";
import type { ClassificationStatus } from "@/api/types/classification";
import type {
  ConstructionObject,
  ObjectFile,
  UploadResponse,
} from "@/api/types/objects";
import type { ParsingStatus } from "@/api/types/parsing";
import routeNames from "@/routes/routeNames";

import { DocumentUploadPage } from "./DocumentUploadPage";

vi.mock("@/api/endpoints/objects", () => ({
  getObject: vi.fn(),
  listFiles: vi.fn(),
  getReceipt: vi.fn(),
  uploadDocuments: vi.fn(),
  downloadOriginal: vi.fn(),
}));
vi.mock("@/api/endpoints/parsing", () => ({
  getParsingStatus: vi.fn(),
  getParseResult: vi.fn(),
  getRenderedPage: vi.fn(),
  retryParsing: vi.fn(),
}));
vi.mock("@/api/endpoints/classification", () => ({
  getClassificationStatus: vi.fn(),
  getKindOptions: vi.fn(),
  resolveClassification: vi.fn(),
  retryClassification: vi.fn(),
}));
vi.mock("@/api/endpoints/completeness", () => ({
  getExpectedPackage: vi.fn(),
  generateExpectedPackage: vi.fn(),
  confirmExpectedPackage: vi.fn(),
  evaluateCompleteness: vi.fn(),
  getCompletenessResult: vi.fn(),
}));
vi.mock("@/api/endpoints/identification", () => ({
  getIdentification: vi.fn(),
}));
vi.mock("@/api/endpoints/extraction", () => ({ getExtractions: vi.fn() }));
vi.mock("@/api/endpoints/verification", () => ({ generateProtocol: vi.fn() }));

const object: ConstructionObject = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Синтетический объект",
  created_by: "synthetic",
  created_at: "2026-09-17T00:00:00.000Z",
  updated_at: "2026-09-17T00:00:00.000Z",
  allowed_actions: ["upload"],
};

const projectFile: ObjectFile = {
  id: "22222222-2222-4222-8222-222222222222",
  object_id: object.id,
  process_id: "33333333-3333-4333-8333-333333333333",
  run_id: "44444444-4444-4444-8444-444444444444",
  original_name: "01_Пояснительная_записка.pdf",
  size: 2_048_000,
  format: "PDF",
  sha256: "a".repeat(64),
  created_at: "2026-09-17T00:00:00.000Z",
  integrity_error: false,
};

const reviewFile: ObjectFile = {
  ...projectFile,
  id: "55555555-5555-4555-8555-555555555555",
  original_name: "12_Комплект_ЭОМ.pdf",
};

const parsingStatus: ParsingStatus = {
  schema_version: 1,
  active: false,
  poll_after_ms: 2000,
  items: [
    {
      file_id: projectFile.id,
      process_id: projectFile.process_id,
      run_id: projectFile.run_id,
      original_name: projectFile.original_name,
      state: "succeeded",
      attempt: 1,
      pages_completed: 10,
      pages_total: 10,
      quality: "OK",
      reasons: [],
      error_code: null,
      can_retry: false,
      artifact_id: "66666666-6666-4666-8666-666666666666",
    },
    {
      file_id: reviewFile.id,
      process_id: reviewFile.process_id,
      run_id: reviewFile.run_id,
      original_name: reviewFile.original_name,
      state: "succeeded",
      attempt: 1,
      pages_completed: 4,
      pages_total: 4,
      quality: "OK",
      reasons: [],
      error_code: null,
      can_retry: false,
      artifact_id: "77777777-7777-4777-8777-777777777777",
    },
  ],
};

const classificationStatus: ClassificationStatus = {
  schema_version: 1,
  active: false,
  poll_after_ms: 2000,
  items: [
    {
      file_id: projectFile.id,
      process_id: projectFile.process_id,
      run_id: projectFile.run_id,
      artifact_id: "66666666-6666-4666-8666-666666666666",
      original_name: projectFile.original_name,
      task_id: null,
      state: "succeeded",
      can_retry: false,
      error_code: null,
      result: {
        schema_version: 1,
        stage: "PD",
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
    },
    {
      file_id: reviewFile.id,
      process_id: reviewFile.process_id,
      run_id: reviewFile.run_id,
      artifact_id: "77777777-7777-4777-8777-777777777777",
      original_name: reviewFile.original_name,
      task_id: null,
      state: "succeeded",
      can_retry: false,
      error_code: null,
      result: {
        schema_version: 1,
        stage: "RD",
        document_kind: null,
        method: "llm",
        needs_review: true,
        reasons: ["Низкая уверенность классификатора"],
        evidence: [],
        candidates: [],
        versions: {
          classifier: "v1",
          rules: "v1",
          context: "v1",
          prompt: "v1",
          model: "synthetic",
        },
      },
    },
  ],
};

function Location() {
  return (
    <p data-testid="location">
      {useLocation().pathname}
      {useLocation().search}
    </p>
  );
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[routeNames.OBJECT_UPLOAD(object.id)]}>
        <Routes>
          <Route
            element={<DocumentUploadPage />}
            path={routeNames.OBJECT_UPLOAD(":objectId")}
          />
          <Route path="/verification" element={<Location />} />
          <Route path="/objects/:objectId/documents" element={<Location />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function selectFiles(container: HTMLElement, files: File[]) {
  const input = container.querySelector<HTMLInputElement>(
    'input[type="file"]:not([webkitdirectory])',
  );
  expect(input).not.toBeNull();
  fireEvent.change(input!, { target: { files } });
}

beforeEach(() => {
  vi.resetAllMocks();
  window.localStorage.clear();
  vi.mocked(getObject).mockResolvedValue(object);
  vi.mocked(getIdentification).mockResolvedValue({
    ...idRegistry,
    object_id: object.id,
    process_id: projectFile.process_id,
    run_id: projectFile.run_id,
    current_run_id: projectFile.run_id,
  });
  vi.mocked(getExtractions).mockResolvedValue({
    schema_version: 1,
    active: false,
    poll_after_ms: 2000,
    ruleset_fingerprint: null,
    items: [],
    tasks: [],
  });
  vi.mocked(generateProtocol).mockResolvedValue({
    schema_version: 1,
    object_id: object.id,
    protocol_id: object.id,
    protocol_version: 1,
    status: "active",
    findings: 132,
    reused: false,
  });
  vi.mocked(listFiles).mockResolvedValue({
    items: [projectFile, reviewFile],
    total: 2,
    page: 1,
    limit: 100,
  });
  vi.mocked(getParsingStatus).mockResolvedValue(parsingStatus);
  vi.mocked(getClassificationStatus).mockResolvedValue(classificationStatus);
  vi.mocked(getKindOptions).mockResolvedValue({
    schema_version: 1,
    options: {
      PD: [{ code: "ПЗ", title: "Пояснительная записка" }],
      RD: [{ code: "СО", title: "Спецификация оборудования" }],
      ID: [
        {
          code: "AOSR",
          title: "Акт освидетельствования скрытых работ",
        },
      ],
    },
  });
  vi.mocked(getExpectedPackage).mockResolvedValue({
    schema_version: 1,
    object_id: object.id,
    package: null,
    package_absent_reason: "not_generated",
  });
  vi.mocked(getCompletenessResult).mockResolvedValue({
    schema_version: 1,
    object_id: object.id,
    process_id: null,
    run_id: null,
    package_version: null,
    framework_version: null,
    evaluated_at: null,
    evaluation: null,
    evaluation_absent_reason: "Нет подтверждённого перечня",
  });
});

describe("DocumentUploadPage", () => {
  it("показывает реальные файлы объекта со стадиями и статусами классификации", async () => {
    mount();

    expect(
      await screen.findByRole("heading", {
        name: "Загруженные документы (2)",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(object.name)).toBeInTheDocument();
    expect(
      screen.getAllByText("01_Пояснительная_записка.pdf").length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("12_Комплект_ЭОМ.pdf").length).toBeGreaterThan(
      0,
    );

    const filters = screen.getByLabelText("Фильтр документов");
    expect(await within(filters).findByText("ПД 1")).toBeInTheDocument();
    expect(within(filters).getByText("Все 2")).toBeInTheDocument();
    expect(within(filters).getByText("РД 1")).toBeInTheDocument();
    expect(within(filters).getByText("ИД 0")).toBeInTheDocument();
    expect(
      within(filters).getByText("Требуют уточнения 1"),
    ).toBeInTheDocument();

    expect(screen.getAllByText("Определено").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Требует уточнения").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Подтвердите сведения в карточке документа.").length,
    ).toBeGreaterThan(0);
    expect(await screen.findByText("1 файлов готовы")).toBeInTheDocument();
    expect(
      screen.queryByText("Для 6 контрольных параметров"),
    ).not.toBeInTheDocument();
  });

  it("показывает честное пустое состояние без демонстрационных данных", async () => {
    vi.mocked(listFiles).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 100,
    });
    vi.mocked(getParsingStatus).mockResolvedValue({
      ...parsingStatus,
      items: [],
    });
    vi.mocked(getClassificationStatus).mockResolvedValue({
      ...classificationStatus,
      items: [],
    });
    mount();

    expect(
      await screen.findByRole("heading", {
        name: "Загруженные документы (0)",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Документы не найдены").length).toBeGreaterThan(
      0,
    );
    expect(
      await screen.findByText(/Состав комплекта ещё не задан/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Загрузить документы" }),
    ).toBeDisabled();
  });

  it("добавляет файлы в пакет с заявленной стадией и отправляет их", async () => {
    const uploadResponse: UploadResponse = {
      schema_version: 1,
      object_id: object.id,
      client_upload_id: "88888888-8888-4888-8888-888888888888",
      process_id: object.id,
      run_id: "99999999-9999-4999-8999-999999999999",
      files: [
        {
          client_file_id: "77777777-7777-4777-8777-777777777777",
          original_name: "23_Новый_раздел.pdf",
          accepted: true,
          file_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          sha256: "b".repeat(64),
          size: 5,
          format: "PDF",
        },
      ],
    };
    vi.mocked(uploadDocuments).mockImplementation(
      (input): Promise<UploadResponse> =>
        Promise.resolve({
          ...uploadResponse,
          client_upload_id: input.uploadId,
          files: input.files.map((file) => ({
            client_file_id: file.id,
            original_name: file.file.name,
            accepted: true,
            file_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            sha256: "b".repeat(64),
            size: 5,
            format: "PDF",
          })),
        }),
    );
    vi.mocked(getReceipt).mockResolvedValue(uploadResponse);

    const { container } = mount();
    await screen.findByRole("heading", {
      name: "Загруженные документы (2)",
    });

    fireEvent.click(
      within(
        screen.getByLabelText("Стадия загружаемой документации"),
      ).getByText("Рабочая (РД)"),
    );

    selectFiles(container, [
      new File(["valid"], "23_Новый_раздел.pdf", { type: "application/pdf" }),
    ]);

    expect(
      await screen.findByRole("heading", {
        name: "Загруженные документы (3)",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("В пакете").length).toBeGreaterThan(0);

    fireEvent.click(
      screen.getByRole("button", { name: "Загрузить документы" }),
    );

    await waitFor(() => {
      expect(uploadDocuments).toHaveBeenCalledTimes(1);
    });
    const input = vi.mocked(uploadDocuments).mock.calls[0]?.[0];
    expect(input?.objectId).toBe(object.id);
    expect(typeof input?.uploadId).toBe("string");
    expect(input?.files).toHaveLength(1);
    expect(input?.files[0]?.file.name).toBe("23_Новый_раздел.pdf");
    expect(await screen.findAllByText("Оригинал принят")).not.toHaveLength(0);
  });

  it("сообщает о неподдерживаемом формате и не добавляет файл", async () => {
    const { container } = mount();
    await screen.findByRole("heading", {
      name: "Загруженные документы (2)",
    });

    selectFiles(container, [
      new File(["invalid"], "описание.txt", { type: "text/plain" }),
    ]);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "имеет неподдерживаемый формат",
    );
    expect(
      screen.getByRole("heading", { name: "Загруженные документы (2)" }),
    ).toBeInTheDocument();
    expect(uploadDocuments).not.toHaveBeenCalled();
  });

  it("предупреждает о расхождении заявленной и распознанной стадии", async () => {
    window.localStorage.setItem(
      `inspector-ai:declared-stages:v1:${object.id}`,
      JSON.stringify({ [projectFile.id]: "RD" }),
    );
    mount();

    expect(
      await screen.findByText(/распознанная стадия отличается от заявленной/),
    ).toBeInTheDocument();
  });

  it("блокирует загрузку, когда объект не даёт права на приём", async () => {
    vi.mocked(getObject).mockResolvedValue({
      ...object,
      allowed_actions: [],
    });
    mount();

    expect(
      await screen.findByText(
        "Для этого объекта загрузка документов недоступна.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Загрузить документы" }),
    ).toBeDisabled();
  });

  it("показывает ошибку доступа к объекту", async () => {
    vi.mocked(getObject).mockRejectedValue(new Error("Нет доступа к объекту"));
    mount();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Нет доступа к объекту",
    );
  });

  it("запускает проверку доступного комплекта и открывает экран результатов", async () => {
    mount();
    const button = await screen.findByRole("button", {
      name: "Проверить документы",
    });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByTestId("location")).toHaveTextContent(
      `/verification?objectId=${object.id}`,
    );
    expect(generateProtocol).toHaveBeenCalledWith(object.id);
  });

  it("показывает сохранённое подтверждение и открывает карточку по нажатию статуса", async () => {
    vi.mocked(getClassificationStatus).mockResolvedValue({
      ...classificationStatus,
      items: classificationStatus.items.map((file) => ({
        ...file,
        review: {
          document_id: object.id,
          revision_id: object.id,
          card_version: 2,
          resolved_input_hash: idRegistry.resolved_input_hash!,
          fields: { stage: "RD", code: "Синтетический шифр" },
          confirmed_fields: ["stage"],
          needs_review: false,
          reasons: [],
          source_issues: [],
        },
      })),
    });
    mount();
    await waitFor(() => expect(getClassificationStatus).toHaveBeenCalled());
    await waitFor(
      () =>
        expect(
          screen.getAllByText("Проверено инспектором").length,
        ).toBeGreaterThan(0),
      { timeout: 5000 },
    );
    const buttons = await screen.findAllByRole(
      "button",
      {
        name: `Проверено инспектором: ${reviewFile.original_name}`,
      },
      { timeout: 5000 },
    );
    fireEvent.click(buttons[0]!);
    expect(await screen.findByTestId("location")).toHaveTextContent(
      `fileId=${reviewFile.id}`,
    );
    expect(generateProtocol).not.toHaveBeenCalled();
  });

  it("не запускает проверку пока текущие документы обрабатываются", async () => {
    vi.mocked(getExtractions).mockResolvedValue({
      schema_version: 1,
      active: true,
      poll_after_ms: 2000,
      ruleset_fingerprint: null,
      items: [],
      tasks: [],
    });
    mount();
    expect(
      await screen.findByRole("button", { name: "Документы обрабатываются…" }),
    ).toBeDisabled();
    expect(generateProtocol).not.toHaveBeenCalled();
  });

  it("сохраняет видимое подтверждение реквизитов рядом с предупреждением о файле", async () => {
    vi.mocked(getClassificationStatus).mockResolvedValue({
      ...classificationStatus,
      items: classificationStatus.items.map((file) => ({
        ...file,
        review: {
          document_id: object.id,
          revision_id: object.id,
          card_version: 2,
          resolved_input_hash: idRegistry.resolved_input_hash!,
          fields: { stage: "RD" },
          confirmed_fields: ["stage"],
          needs_review: false,
          reasons: [],
          source_issues: ["partial_parse_requires_review"],
        },
      })),
    });
    mount();
    await waitFor(() => expect(getClassificationStatus).toHaveBeenCalled());
    expect(
      (
        await screen.findAllByText(
          "Реквизиты подтверждены",
          {},
          { timeout: 5000 },
        )
      ).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", {
        name: `Проверьте файл: ${reviewFile.original_name}`,
      }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Часть файла не прочитана. Проверьте оригинал.")
        .length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(
        "Откройте отмеченные документы и проверьте указанные вопросы.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("2 требуют внимания")).toBeInTheDocument();
  });

  it("не использует исторический запуск для новой проверки", async () => {
    vi.mocked(getIdentification).mockResolvedValue({
      ...idRegistry,
      current: false,
    });
    mount();
    const button = await screen.findByRole("button", {
      name: "Проверить документы",
    });
    expect(button).toBeDisabled();
    expect(generateProtocol).not.toHaveBeenCalled();
  });
});
