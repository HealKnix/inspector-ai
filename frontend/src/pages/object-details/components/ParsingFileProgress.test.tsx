import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { getParsingStatus, retryParsing } from "@/api/endpoints/parsing";
import { useParsingStatus } from "@/api/hooks/use-parsing";
import type { ParsingFile } from "@/api/types/parsing";
import {
  parsedFile,
  parsingObjectId,
  parsingStatus,
} from "@/api/types/parsing-test-fixtures";
import { ParsingFileProgress } from "./ParsingFileProgress";
import { ParsingPanel } from "./ParsingPanel";

vi.mock("@/api/endpoints/parsing", () => ({
  getParsingStatus: vi.fn(),
  retryParsing: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());

const resumedFile: ParsingFile = {
  ...parsedFile,
  state: "processing",
  artifact_id: null,
  can_retry: false,
  pages_completed: 38,
  pages_total: 110,
  phase: "waiting_models",
  waiting_reason: "models_not_ready",
  progress_updated_at: "2026-09-18T08:00:00.000Z",
  retry_at: "2026-09-18T08:01:00.000Z",
  checkpoint_pages: 38,
  checkpoint_validated: false,
};

describe("confirmed parsing progress", () => {
  it("shows model readiness waiting with the previous confirmed count and server timestamps", () => {
    const { container } = render(<ParsingFileProgress file={resumedFile} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Ожидаем готовности моделей распознавания",
    );
    expect(
      screen.getByText("Последний подтверждённый прогресс: 38 из 110 страниц."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Это прогресс предыдущей попытки/),
    ).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "38",
    );
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuemax",
      "110",
    );
    expect(
      container.querySelector('time[datetime="2026-09-18T08:00:00.000Z"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('time[datetime="2026-09-18T08:01:00.000Z"]'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Сохранённые страницы проверены:/),
    ).not.toBeInTheDocument();
  });
  it("replaces historical progress with validated checkpoints, including a lower actual count", () => {
    const view = render(<ParsingFileProgress file={resumedFile} />);
    view.rerender(
      <ParsingFileProgress
        file={{
          ...resumedFile,
          phase: "resuming",
          waiting_reason: null,
          retry_at: null,
          pages_completed: 35,
          checkpoint_pages: 35,
          checkpoint_validated: true,
          progress_reset_reason: "saved_pages_unavailable",
        }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Возобновляем обработку документа",
    );
    expect(
      screen.getByText("Последний подтверждённый прогресс: 35 из 110 страниц."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Сохранённые страницы проверены: 35."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/прогресс предыдущей попытки/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Следующая попытка/)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Часть сохранённых страниц недоступна или повреждена. Обрабатываем их повторно.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "35",
    );
  });
  it("explains reprocessing after a pipeline change without claiming that saved pages were corrupt", () => {
    render(
      <ParsingFileProgress
        file={{
          ...resumedFile,
          phase: "extracting",
          waiting_reason: null,
          retry_at: null,
          checkpoint_validated: true,
          checkpoint_pages: 0,
          pages_completed: 0,
          progress_reset_reason: "pipeline_version_changed",
        }}
      />,
    );
    expect(
      screen.getByText(
        "Версия обработки изменилась. Страницы обрабатываются заново.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/недоступна или повреждена/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
  });
  it("does not invent a page count, a running progress bar, or checkpoints for legacy responses", () => {
    render(
      <ParsingFileProgress
        file={{
          ...parsedFile,
          state: "queued",
          pages_completed: 0,
          pages_total: null,
        }}
      />,
    );
    expect(
      screen.getByText("Подтверждённого прогресса по страницам пока нет."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText(/Сохранённые страницы/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/обрабатываются заново|Обрабатываем их повторно/),
    ).not.toBeInTheDocument();
  });
  it("distinguishes a current OCR page from the last completed page and keeps the prior error visible", () => {
    render(
      <ParsingFileProgress
        file={{
          ...resumedFile,
          phase: "ocr",
          waiting_reason: null,
          retry_at: null,
          current_page: 40,
          previous_attempt_error: "parser_timeout",
          checkpoint_validated: true,
        }}
      />,
    );
    expect(
      screen.getByText("Текущая страница: 40 из 110."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Последний подтверждённый прогресс: 38 из 110 страниц."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Предыдущая попытка: Превышено время обработки файла."),
    ).toBeInTheDocument();
  });
  it("shows a terminal readiness timeout and sends a retry only after an explicit click", async () => {
    const client = new QueryClient();
    vi.mocked(getParsingStatus).mockResolvedValue({
      ...parsingStatus,
      active: false,
      items: [
        {
          ...resumedFile,
          state: "failed",
          can_retry: true,
          phase: null,
          waiting_reason: null,
          retry_at: null,
          error_code: "models_not_ready_timeout",
        },
      ],
    });
    vi.mocked(retryParsing).mockResolvedValue(undefined);
    function Panel() {
      const query = useParsingStatus(parsingObjectId);
      return (
        <ParsingPanel
          objectId={parsingObjectId}
          query={query}
          onOpen={vi.fn()}
        />
      );
    }
    const view = render(
      <QueryClientProvider client={client}>
        <Panel />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Модели распознавания не удалось подготовить вовремя. Обработка остановлена.",
    );
    expect(screen.getByText("Активных обработок нет")).toBeInTheDocument();
    expect(
      screen.queryByText("Ожидаем готовности моделей распознавания"),
    ).not.toBeInTheDocument();
    expect(retryParsing).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Повторить обработку" }),
    );
    await waitFor(() => expect(retryParsing).toHaveBeenCalledTimes(1));
    view.unmount();
    client.clear();
  });
});
