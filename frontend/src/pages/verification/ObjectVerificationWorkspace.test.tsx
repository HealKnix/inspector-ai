import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { getObject } from "@/api/endpoints/objects";
import {
  getParseResult,
  getParsingStatus,
  getRenderedPage,
} from "@/api/endpoints/parsing";
import {
  getFinding,
  getProtocol,
  listFindings,
  postDecision,
} from "@/api/endpoints/verification";
import { queryKeys } from "@/api/query-keys";
import type { ConstructionObject } from "@/api/types/objects";
import {
  parsedFile,
  parseResult,
  parsingObjectId,
} from "@/api/types/parsing-test-fixtures";
import routeNames from "@/routes/routeNames";

import { VerificationPage } from "./VerificationPage";

vi.mock("@/api/endpoints/objects", () => ({
  createObject: vi.fn(),
  getObject: vi.fn(),
  getReceipt: vi.fn(),
  listFiles: vi.fn(),
  listObjects: vi.fn(),
  uploadDocuments: vi.fn(),
}));

vi.mock("@/api/endpoints/parsing", () => ({
  getParseResult: vi.fn(),
  getParsingStatus: vi.fn(),
  getRenderedPage: vi.fn(),
  retryParsing: vi.fn(),
}));

vi.mock("@/api/endpoints/verification", () => ({
  finalizeProtocol: vi.fn(),
  generateProtocol: vi.fn(),
  getFinding: vi.fn(),
  getProtocol: vi.fn(),
  listFindings: vi.fn(),
  postDecision: vi.fn(),
}));

const object: ConstructionObject = {
  id: parsingObjectId,
  name: "Синтетический объект для предпросмотра",
  created_by: "synthetic",
  created_at: "2026-09-20T00:00:00.000Z",
  updated_at: "2026-09-20T00:00:00.000Z",
  allowed_actions: [],
};
const revokeObjectUrl = vi.fn();

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={[
          routeNames.DOCUMENT_VERIFICATION_DETAILS(parsingObjectId),
        ]}
      >
        <VerificationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { ...view, client };
}

beforeEach(() => {
  vi.resetAllMocks();
  URL.createObjectURL = vi.fn(() => "blob:synthetic-verification-page");
  URL.revokeObjectURL = revokeObjectUrl;
  vi.mocked(getObject).mockResolvedValue(object);
  vi.mocked(getRenderedPage).mockResolvedValue(
    new Blob(["synthetic"], { type: "image/png" }),
  );
  vi.mocked(getProtocol).mockResolvedValue({
    schema_version: 1,
    object_id: parsingObjectId,
    process_status: "READY",
    protocol: null,
    versions: [],
    protocol_absent_reason: "protocol_not_generated",
  });
});

describe("object verification workspace", () => {
  it("открывает реальные страницы комплекта через защищённый предпросмотр", async () => {
    const file = {
      ...parsedFile,
      pages_completed: 2,
      pages_total: 2,
    };
    const result = structuredClone(parseResult);
    const secondPage = structuredClone(result.artifact.pages[0]!);
    secondPage.page_number = 2;
    secondPage.image_key = "88888888-8888-4888-8888-888888888888";
    secondPage.blocks = secondPage.blocks.map((block) => ({
      ...block,
      id: `${block.id}-page-2`,
    }));
    result.artifact.pages.push(secondPage);
    result.artifact.coverage = {
      total_pages: 2,
      readable_pages: 2,
      unreadable_pages: 0,
    };

    vi.mocked(getParsingStatus).mockResolvedValue({
      schema_version: 1,
      active: false,
      poll_after_ms: 2000,
      items: [file],
    });
    vi.mocked(getParseResult).mockResolvedValue(result);

    const view = renderPage();

    expect(
      await screen.findByRole("heading", {
        name: "Проверка комплекта документов",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("ДАННЫЕ ОБЪЕКТА")).toBeVisible();
    expect(screen.queryByText("ДЕМО")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Список расхождений" }),
    ).not.toBeInTheDocument();

    expect(
      await screen.findByRole("img", {
        name: "Страница 1 документа synthetic.xml",
      }),
    ).toBeInTheDocument();
    expect(getObject).toHaveBeenCalledWith(
      parsingObjectId,
      expect.any(AbortSignal),
    );
    expect(getParseResult).toHaveBeenCalledWith(
      parsingObjectId,
      file.file_id,
      file.run_id,
      file.artifact_id,
      expect.any(AbortSignal),
    );
    expect(getRenderedPage).toHaveBeenCalledWith(
      parsingObjectId,
      file.file_id,
      file.artifact_id,
      1,
      expect.any(AbortSignal),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Следующая страница, Ожидаемое (ПД)",
      }),
    );

    expect(
      await screen.findByRole("img", {
        name: "Страница 2 документа synthetic.xml",
      }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(getRenderedPage).toHaveBeenCalledWith(
        parsingObjectId,
        file.file_id,
        file.artifact_id,
        2,
        expect.any(AbortSignal),
      ),
    );

    view.unmount();
    expect(revokeObjectUrl).toHaveBeenCalled();
    view.client.clear();
  });

  it("показывает находки протокола и отправляет решение через API", async () => {
    const findingId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const item = {
      id: findingId,
      parameter_code: "P022",
      parameter_name: "Класс стойкости",
      scope_key: "object",
      status: "CANDIDATE" as const,
      risk: "критичный",
      reason_code: null,
      comment: null,
      decided_at: null,
      finding_version: 2,
      gate_reasons: null,
      verdict: {
        engine: "comparison-v1",
        status: "discrepancy" as const,
        spec: { kind: "equals" },
        expected: [
          {
            extraction_id: "88888888-8888-4888-8888-888888888888",
            file_id: parsedFile.file_id,
            value: "II",
            value_raw: "II",
            unit: null,
          },
        ],
        actual: [],
        pairs: [],
        warnings: [],
        evaluated_at: "2026-10-01T00:00:00.000Z",
      },
    };

    vi.mocked(getProtocol).mockResolvedValue({
      schema_version: 1,
      object_id: parsingObjectId,
      process_status: "VERIFYING",
      protocol: {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        version: 1,
        status: "active",
        scenario: "initial",
        created_at: "2026-10-01T00:00:00.000Z",
        finalized_at: null,
        findings: 1,
      },
      versions: [],
      protocol_absent_reason: null,
    });
    vi.mocked(listFindings).mockResolvedValue({
      schema_version: 1,
      object_id: parsingObjectId,
      protocol_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      items: [item],
      findings_absent_reason: null,
    });
    vi.mocked(getFinding).mockResolvedValue({
      schema_version: 1,
      object_id: parsingObjectId,
      finding: {
        ...item,
        protocol_version: 1,
        members: [
          {
            extraction_id: "88888888-8888-4888-8888-888888888888",
            file_id: parsedFile.file_id,
            stage: "PD",
            role: "expected" as const,
            status: "extracted",
            value: "II",
            value_raw: "II",
            unit: null,
            evidence: [
              {
                extractionId: "88888888-8888-4888-8888-888888888888",
                fileId: parsedFile.file_id,
                pageNumber: 1,
                sheetLabel: null,
                blockId: "block-1",
                quote: "Класс стойкости II",
                bbox: [0.1, 0.2, 0.4, 0.25],
              },
            ],
          },
        ],
        decisions: [],
      },
    });
    vi.mocked(getParsingStatus).mockResolvedValue({
      schema_version: 1,
      active: false,
      poll_after_ms: 2000,
      items: [parsedFile],
    });
    vi.mocked(getParseResult).mockResolvedValue(structuredClone(parseResult));
    vi.mocked(postDecision).mockResolvedValue({
      schema_version: 1,
      object_id: parsingObjectId,
      finding: { ...item, status: "CONFIRMED_VIOLATION" as const },
      process_status: "COMPLETED",
      replayed: false,
    });

    const view = renderPage();

    expect(
      await screen.findByRole("heading", { name: "Список расхождений" }),
    ).toBeInTheDocument();
    const card = await screen.findByRole("button", {
      name: /P022 · Класс стойкости/,
    });
    fireEvent.click(card);

    expect(
      await screen.findByRole("button", { name: "Подтвердить нарушение" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Подтвердить нарушение" }),
    );
    fireEvent.change(screen.getByLabelText("Комментарий инспектора"), {
      target: { value: "Расхождение подтверждено по оригиналу." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить решение" }));

    await waitFor(() => expect(postDecision).toHaveBeenCalledTimes(1));
    const [, calledFindingId, body] = vi.mocked(postDecision).mock.calls[0]!;
    expect(calledFindingId).toBe(findingId);
    expect(body).toMatchObject({
      action: "confirm",
      finding_version: 2,
      comment: "Расхождение подтверждено по оригиналу.",
    });
    expect(body.request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    view.unmount();
    view.client.clear();
  });

  it("не запрашивает страницы до успешного завершения обработки", async () => {
    vi.mocked(getParsingStatus).mockResolvedValue({
      schema_version: 1,
      active: true,
      poll_after_ms: 2000,
      items: [
        {
          ...parsedFile,
          state: "processing",
          artifact_id: null,
          pages_completed: 0,
          pages_total: null,
        },
      ],
    });

    const view = renderPage();

    expect(
      await screen.findByText(
        "Страницы появятся после успешного завершения обработки хотя бы одного документа.",
      ),
    ).toBeInTheDocument();
    expect(getParseResult).not.toHaveBeenCalled();
    expect(getRenderedPage).not.toHaveBeenCalled();

    view.unmount();
    view.client.clear();
  });

  it("скрывает страницы после отзыва доступа к объекту", async () => {
    vi.mocked(getParsingStatus).mockResolvedValue({
      schema_version: 1,
      active: false,
      poll_after_ms: 2000,
      items: [parsedFile],
    });
    vi.mocked(getParseResult).mockResolvedValue(structuredClone(parseResult));
    const view = renderPage();

    expect(
      await screen.findByRole("img", {
        name: "Страница 1 документа synthetic.xml",
      }),
    ).toBeInTheDocument();

    vi.mocked(getObject).mockRejectedValue(new Error("Нет доступа к объекту"));
    await act(() =>
      view.client.invalidateQueries({
        queryKey: queryKeys.objects.detail(parsingObjectId),
        exact: true,
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Нет доступа к объекту",
    );
    expect(
      screen.queryByRole("img", {
        name: "Страница 1 документа synthetic.xml",
      }),
    ).not.toBeInTheDocument();

    view.unmount();
    view.client.clear();
  });
});
