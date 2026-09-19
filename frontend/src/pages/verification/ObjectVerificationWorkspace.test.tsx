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
      <MemoryRouter initialEntries={[routeNames.verification(parsingObjectId)]}>
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
        name: "Следующая страница, Документ 1",
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
