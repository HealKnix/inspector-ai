import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";

import {
  downloadOriginal,
  getObject,
  listFiles,
} from "@/api/endpoints/objects";
import {
  getParseResult,
  getParsingStatus,
  getRenderedPage,
} from "@/api/endpoints/parsing";
import { queryKeys } from "@/api/query-keys";
import { Role } from "@/api/types/auth";
import type { ConstructionObject, ObjectFile } from "@/api/types/objects";
import {
  createRegionalParseResult,
  parsingStatus,
} from "@/api/types/parsing-test-fixtures";
import routeNames from "@/routes/routeNames";
import { useAuthSessionStore } from "@/store/auth-session";
import { ObjectDetailsPage } from "./ObjectDetailsPage";

vi.mock("@/api/endpoints/parsing", () => ({
  getParsingStatus: vi.fn(),
  getParseResult: vi.fn(),
  getRenderedPage: vi.fn(),
  retryParsing: vi.fn(),
}));

vi.mock("@/api/endpoints/objects", () => ({
  getObject: vi.fn(),
  listFiles: vi.fn(),
  downloadOriginal: vi.fn(),
}));

const object: ConstructionObject = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Синтетический объект",
  created_by: "synthetic",
  created_at: "2026-09-17T00:00:00.000Z",
  updated_at: "2026-09-17T00:00:00.000Z",
  allowed_actions: [],
};
const file: ObjectFile = {
  id: "22222222-2222-4222-8222-222222222222",
  object_id: object.id,
  process_id: "33333333-3333-4333-8333-333333333333",
  run_id: "44444444-4444-4444-8444-444444444444",
  original_name: "synthetic.xml",
  size: 2000,
  format: "XML",
  sha256: "a".repeat(64),
  created_at: "2026-09-17T00:00:00.000Z",
  integrity_error: false,
};
function LocationProbe() {
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="location">{useLocation().search}</output>
      <output data-testid="pathname">{useLocation().pathname}</output>
      <button
        onClick={() => {
          void navigate(-1);
        }}
      >
        Назад по истории
      </button>
      <button
        onClick={() => {
          void navigate(1);
        }}
      >
        Вперёд по истории
      </button>
    </>
  );
}
function mount(search = "") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/app/objects/${object.id}${search}`]}>
        <Routes>
          <Route
            path="/app/objects/:objectId"
            element={<ObjectDetailsPage />}
          />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
beforeEach(() => {
  vi.resetAllMocks();
  useAuthSessionStore.setState({
    accessToken: "synthetic-access-token",
    initialized: true,
    user: {
      id: "77777777-7777-4777-8777-777777777777",
      login: "synthetic-inspector",
      role: Role.INSPECTOR,
      createdAt: "2026-09-20T00:00:00.000Z",
    },
  });
  vi.mocked(getObject).mockResolvedValue(object);
  vi.mocked(listFiles).mockResolvedValue({
    items: [file],
    total: 1,
    page: 1,
    limit: 20,
  });
  vi.mocked(downloadOriginal).mockResolvedValue(undefined);
  vi.mocked(getParsingStatus).mockResolvedValue({
    schema_version: 1,
    active: false,
    poll_after_ms: 2000,
    items: [],
  });
});

describe("object documents", () => {
  it("открывает проверку метаданных в контексте текущего объекта", async () => {
    mount();

    fireEvent.click(
      await screen.findByRole("button", { name: "Проверить метаданные" }),
    );

    expect(screen.getByTestId("pathname")).toHaveTextContent(routeNames.APP);
    expect(screen.getByTestId("location")).toHaveTextContent(
      `?objectId=${object.id}`,
    );
  });

  it("сохраняет режим и выбранную область в URL и восстанавливает их при возврате по истории", async () => {
    URL.createObjectURL = vi.fn(() => "blob:synthetic-regional-page");
    URL.revokeObjectURL = vi.fn();
    vi.mocked(getParseResult).mockResolvedValue(createRegionalParseResult());
    vi.mocked(getRenderedPage).mockResolvedValue(new Blob(["synthetic"]));
    vi.mocked(getParsingStatus).mockResolvedValue(parsingStatus);
    mount(`?upload=receipt-id&file=${file.id}&documentPage=1`);
    await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "Области" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Область 2: Графическая область" }),
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "documentView=regions",
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "documentRegion=graphic-region",
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "upload=receipt-id",
    );
    fireEvent.click(screen.getByRole("button", { name: "Весь документ" }));
    expect(screen.getByLabelText("Полный текст документа")).toHaveTextContent(
      "Размер −250",
    );
    fireEvent.click(screen.getByRole("button", { name: "Назад по истории" }));
    expect(screen.getByRole("button", { name: "Области" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: "Область 2: Графическая область" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Вперёд по истории" }));
    expect(
      screen.getByRole("button", { name: "Весь документ" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(
      screen.getByRole("button", { name: "Закрыть просмотр документа" }),
    );
    expect(screen.getByTestId("location").textContent).toBe(
      "?upload=receipt-id",
    );
  });
  it("показывает оригиналы из API и скачивает файл, скрывая недоступную загрузку", async () => {
    mount();
    const download = await screen.findByRole("button", {
      name: "Скачать оригинал: synthetic.xml",
    });
    expect(screen.getByRole("link", { name: "Все объекты" })).toHaveAttribute(
      "href",
      "/app/objects",
    );
    expect(
      screen.queryByRole("button", { name: "Загрузить документы" }),
    ).not.toBeInTheDocument();
    fireEvent.click(download);
    await waitFor(() =>
      expect(downloadOriginal).toHaveBeenCalledWith(
        object.id,
        file.id,
        file.original_name,
      ),
    );
  });
  it("не позволяет скачать повреждённый оригинал", async () => {
    vi.mocked(listFiles).mockResolvedValue({
      items: [{ ...file, integrity_error: true }],
      total: 1,
      page: 1,
      limit: 20,
    });
    mount();
    expect(
      await screen.findByText("Нарушена целостность оригинала"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Скачать оригинал: synthetic.xml" }),
    ).toBeDisabled();
  });
  it("сохраняет ссылку на приём при переходе между страницами файлов", async () => {
    vi.mocked(listFiles).mockResolvedValue({
      items: [file],
      total: 21,
      page: 1,
      limit: 20,
    });
    mount("?upload=receipt-id");
    fireEvent.click(await screen.findByRole("button", { name: "Далее" }));
    await waitFor(() =>
      expect(listFiles).toHaveBeenCalledWith(
        object.id,
        2,
        expect.any(AbortSignal),
      ),
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "upload=receipt-id",
    );
    expect(screen.getByTestId("location")).toHaveTextContent("page=2");
    expect(await screen.findByText("Всего 21")).toBeInTheDocument();
  });
  it("не показывает старые файлы как актуальные после ошибки обновления", async () => {
    const client = mount();
    expect(await screen.findByText("synthetic.xml")).toBeInTheDocument();
    vi.mocked(listFiles).mockRejectedValue(
      new Error("Не удалось загрузить оригиналы"),
    );
    await act(() =>
      client.invalidateQueries({
        queryKey: queryKeys.objects.files(object.id, 1),
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Не удалось загрузить оригиналы",
    );
    expect(screen.queryByText("synthetic.xml")).not.toBeInTheDocument();
    expect(screen.queryByText("Всего 1")).not.toBeInTheDocument();
  });
  it("скрывает кешированные документы после отзыва доступа к объекту", async () => {
    const client = mount();
    expect(await screen.findByText("synthetic.xml")).toBeInTheDocument();
    vi.mocked(getObject).mockRejectedValue(new Error("Нет доступа к объекту"));
    await act(() =>
      client.invalidateQueries({
        queryKey: queryKeys.objects.detail(object.id),
        exact: true,
      }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Нет доступа к объекту",
    );
    expect(screen.queryByText("synthetic.xml")).not.toBeInTheDocument();
    expect(screen.queryByText(object.name)).not.toBeInTheDocument();
  });
});
