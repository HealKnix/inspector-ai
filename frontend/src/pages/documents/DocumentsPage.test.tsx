import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import {
  getAdminDocuments,
  getAdminDocumentStats,
  getAdminObjects,
  getAdminParseResult,
  getAdminRenderedPage,
} from "@/api/endpoints/admin-documents";
import { getUsers } from "@/api/endpoints/users";
import type { AdminDocument } from "@/api/types/admin-documents";
import { Role, type UserDto } from "@/api/types/auth";
import { parseResult } from "@/api/types/parsing-test-fixtures";
import { DocumentsPage } from "./DocumentsPage";

vi.mock("@/api/endpoints/admin-documents", () => ({
  getAdminDocuments: vi.fn(),
  getAdminDocumentStats: vi.fn(),
  getAdminObjects: vi.fn(),
  getAdminParseResult: vi.fn(),
  getAdminRenderedPage: vi.fn(),
}));
vi.mock("@/api/endpoints/users", () => ({
  createUser: vi.fn(),
  getUsers: vi.fn(),
  updateUser: vi.fn(),
}));

const inspector: UserDto = {
  id: "22222222-2222-4222-8222-222222222222",
  login: "inspector.ivanov",
  role: Role.INSPECTOR,
  lastName: "Иванов",
  firstName: "Иван",
  patronymic: "Иванович",
  phone: null,
  email: null,
  createdAt: "2026-09-16T12:00:00.000Z",
};

const object = {
  id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  name: "ЖК «Северный»",
};

const processedDocument: AdminDocument = {
  id: parseResult.file_id,
  object_id: object.id,
  object_name: object.name,
  process_id: parseResult.run_id,
  run_id: parseResult.run_id,
  original_name: "Раздел_АР.pdf",
  size: 1_500_000,
  format: "PDF",
  sha256: "a".repeat(64),
  created_at: "2026-09-20T10:00:00.000Z",
  integrity_error: false,
  uploaded_by: {
    id: inspector.id,
    login: inspector.login,
    last_name: inspector.lastName,
    first_name: inspector.firstName,
    patronymic: inspector.patronymic ?? null,
  },
  parsing: {
    state: "succeeded",
    pages_total: 1,
    error_code: null,
    artifact_id: parseResult.artifact_id,
  },
};

const queuedDocument: AdminDocument = {
  ...processedDocument,
  id: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
  original_name: "Приложение_Б.docx",
  format: "DOCX",
  parsing: {
    state: "queued",
    pages_total: null,
    error_code: null,
    artifact_id: null,
  },
};

const documentStats = {
  range: "3m" as const,
  totals: {
    files: 12,
    succeeded: 7,
    in_progress: 3,
    failed: 1,
    integrity_errors: 1,
  },
  uploads: { current: 9, previous: 6, delta_percent: 50 },
  series: [
    { date: "2026-09-18", uploads: 2 },
    { date: "2026-09-19", uploads: 3 },
    { date: "2026-09-20", uploads: 4 },
  ],
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DocumentsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUsers).mockResolvedValue([inspector]);
  vi.mocked(getAdminObjects).mockResolvedValue({ items: [object] });
  vi.mocked(getAdminDocuments).mockResolvedValue({
    items: [processedDocument, queuedDocument],
    total: 2,
    page: 1,
    limit: 20,
  });
  vi.mocked(getAdminDocumentStats).mockResolvedValue(documentStats);
  vi.mocked(getAdminParseResult).mockResolvedValue(parseResult);
  vi.mocked(getAdminRenderedPage).mockResolvedValue(
    new Blob([new Uint8Array([0x89, 0x50])], { type: "image/png" }),
  );
});

describe("DocumentsPage", () => {
  it("показывает документы с пользователем, объектом и состоянием", async () => {
    renderPage();

    expect(await screen.findByText("Раздел_АР.pdf")).toBeInTheDocument();
    expect(screen.getByText("Приложение_Б.docx")).toBeInTheDocument();
    expect(screen.getAllByText("ЖК «Северный»").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Иванов Иван Иванович").length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText("inspector.ivanov").length).toBeGreaterThan(0);
    expect(screen.getByText("Обработан")).toBeInTheDocument();
    expect(screen.getByText("В очереди")).toBeInTheDocument();
  });

  it("показывает аналитику над таблицей", async () => {
    renderPage();

    const analytics = await screen.findByRole("region", {
      name: "Аналитика документов",
    });
    await waitFor(() => {
      expect(analytics).toHaveTextContent("12");
    });
    expect(analytics).toHaveTextContent("Всего документов");
    expect(analytics).toHaveTextContent("Обработано");
    expect(analytics).toHaveTextContent("В обработке");
    expect(analytics).toHaveTextContent("Ошибки");
    expect(analytics).toHaveTextContent("Загрузки растут");
    expect(getAdminDocumentStats).toHaveBeenCalledWith("1d", expect.anything());
  });

  it("запрашивает аналитику за выбранный период", async () => {
    renderPage();
    await screen.findByRole("region", { name: "Аналитика документов" });

    fireEvent.click(screen.getByRole("button", { name: "7 дней" }));

    await waitFor(() => {
      expect(getAdminDocumentStats).toHaveBeenLastCalledWith(
        "7d",
        expect.anything(),
      );
    });
  });

  it("запрашивает документы с фильтром по объекту", async () => {
    renderPage();
    await screen.findByText("Раздел_АР.pdf");

    fireEvent.click(
      screen.getByRole("button", { name: /Фильтр по объекту|Все объекты/ }),
    );
    fireEvent.click(
      await screen.findByRole("option", { name: "ЖК «Северный»" }),
    );

    await waitFor(() => {
      expect(getAdminDocuments).toHaveBeenLastCalledWith(
        expect.objectContaining({ objectId: object.id }),
        expect.anything(),
      );
    });
  });

  it("запрашивает документы с фильтром по пользователю", async () => {
    renderPage();
    await screen.findByText("Раздел_АР.pdf");

    fireEvent.click(
      screen.getByRole("button", {
        name: /Фильтр по пользователю|Все пользователи/,
      }),
    );
    fireEvent.click(
      await screen.findByRole("option", {
        name: "Иванов Иван Иванович · inspector.ivanov",
      }),
    );

    await waitFor(() => {
      expect(getAdminDocuments).toHaveBeenLastCalledWith(
        expect.objectContaining({ userId: inspector.id }),
        expect.anything(),
      );
    });
  });

  it("запрашивает документы по поисковому запросу", async () => {
    renderPage();
    await screen.findByText("Раздел_АР.pdf");

    const input = screen.getByPlaceholderText("Файл, объект или пользователь…");
    fireEvent.change(input, { target: { value: "се" } });
    fireEvent.change(input, { target: { value: "северный" } });

    await waitFor(() => {
      expect(getAdminDocuments).toHaveBeenLastCalledWith(
        expect.objectContaining({ q: "северный", page: 1 }),
        expect.anything(),
      );
    });
    expect(getAdminDocuments).not.toHaveBeenCalledWith(
      expect.objectContaining({ q: "се" }),
      expect.anything(),
    );
  });

  it("не даёт открыть просмотр необработанного документа", async () => {
    renderPage();
    await screen.findByText("Приложение_Б.docx");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Действия с документом Приложение_Б.docx",
      }),
    );
    expect(
      await screen.findByRole("menuitem", { name: "Просмотр" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("открывает просмотр обработанного документа в модалке", async () => {
    renderPage();
    await screen.findByText("Раздел_АР.pdf");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Действия с документом Раздел_АР.pdf",
      }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Просмотр" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Раздел_АР.pdf");

    await waitFor(() => {
      expect(getAdminParseResult).toHaveBeenCalledWith(
        processedDocument.id,
        parseResult.artifact_id,
        expect.anything(),
      );
    });
    expect(await screen.findByText("Стр. 1 из 1")).toBeInTheDocument();
  });
});
