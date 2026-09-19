import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import {
  getClassificationStatus,
  retryClassification,
} from "@/api/endpoints/classification";
import { useClassificationStatus } from "@/api/hooks/use-classification";
import {
  classificationResult,
  classificationStatus,
  classifiedFile,
} from "@/api/types/classification-test-fixtures";
import {
  parsedFile,
  parsingObjectId,
  parsingStatus,
} from "@/api/types/parsing-test-fixtures";
import { ClassificationPanel } from "./ClassificationPanel";

vi.mock("@/api/endpoints/classification", () => ({
  getClassificationStatus: vi.fn(),
  retryClassification: vi.fn(),
}));
const clients = new Set<QueryClient>();
beforeEach(() => {
  vi.resetAllMocks();
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  vi.mocked(getClassificationStatus).mockResolvedValue(classificationStatus);
});
afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.clear();
  vi.restoreAllMocks();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});

function mount(artifactId = parsedFile.artifact_id) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.add(client);
  const onEvidence = vi.fn();
  function Panel() {
    const query = useClassificationStatus(parsingObjectId, parsingStatus);
    return (
      <ClassificationPanel
        objectId={parsingObjectId}
        query={query}
        parsingFiles={[{ ...parsedFile, artifact_id: artifactId }]}
        onEvidence={onEvidence}
      />
    );
  }
  const view = render(
    <QueryClientProvider client={client}>
      <Panel />
    </QueryClientProvider>,
  );
  return { ...view, client, onEvidence };
}

describe("classification panel", () => {
  it.each(["queued", "processing", "failed", "succeeded"] as const)(
    "предлагает явный повтор после изменения настроек при состоянии %s",
    async (state) => {
      vi.mocked(getClassificationStatus).mockResolvedValue({
        ...classificationStatus,
        active: false,
        items: [
          {
            ...classifiedFile,
            state,
            can_retry: true,
            error_code: "classification_configuration_changed",
            result: state === "succeeded" ? classificationResult : null,
          },
        ],
      });
      vi.mocked(retryClassification).mockImplementation(({ requestId }) =>
        Promise.resolve({
          request_id: requestId,
          task_id: classifiedFile.task_id!,
        }),
      );
      const view = mount();
      expect(
        await screen.findByText(
          "Настройки классификации изменились. Запустите повтор с текущими настройками.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(
        screen.queryByText("Классификация продолжается"),
      ).not.toBeInTheDocument();
      expect(retryClassification).not.toHaveBeenCalled();
      if (state === "succeeded") {
        expect(
          screen.getByText("ПД — проектная документация"),
        ).toBeInTheDocument();
        expect(screen.getByText("ПРОЕКТНАЯ ДОКУМЕНТАЦИЯ")).toBeInTheDocument();
      }
      const button = screen.getByRole("button", {
        name: "Повторить классификацию: synthetic.xml",
      });
      expect(button).toBeEnabled();
      fireEvent.click(button);
      await screen.findByText("Запрос классификации принят.");
      expect(retryClassification).toHaveBeenCalledTimes(1);
      view.unmount();
      view.client.clear();
    },
  );
  it("показывает предложение модели как требующее уточнения, а цитату — обычным текстом", async () => {
    const quote = '<img src="x" onerror="alert(1)">ПРОЕКТНАЯ ДОКУМЕНТАЦИЯ';
    vi.mocked(getClassificationStatus).mockResolvedValue({
      ...classificationStatus,
      items: [
        {
          ...classifiedFile,
          result: {
            ...classificationResult,
            method: "llm",
            needs_review: true,
            reasons: ["llm_requires_review"],
            evidence: [{ ...classificationResult.evidence[0]!, quote }],
          },
        },
      ],
    });
    const view = mount();
    expect(
      await screen.findByText("Модель · Предложено моделью"),
    ).toBeInTheDocument();
    expect(screen.getByText("Требует уточнения")).toBeInTheDocument();
    expect(screen.getByText(quote)).toBeInTheDocument();
    expect(view.container.querySelector("img")).toBeNull();
    fireEvent.click(screen.getByText("Признаки в документе (1)"));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Открыть признак 1: synthetic.xml, страница 1",
      }),
    );
    expect(view.onEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ artifact_id: classifiedFile.artifact_id }),
      expect.objectContaining({ page_number: 1, block_id: "block-1", quote }),
    );
    view.unmount();
    view.client.clear();
  });
  it("сохраняет неизвестную принадлежность и не подставляет класс по умолчанию", async () => {
    vi.mocked(getClassificationStatus).mockResolvedValue({
      ...classificationStatus,
      items: [
        {
          ...classifiedFile,
          result: {
            ...classificationResult,
            stage: null,
            document_kind: null,
            method: "none",
            needs_review: true,
          },
        },
      ],
    });
    const view = mount();
    expect(
      await screen.findByText("Принадлежность не определена"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("ПД — проектная документация"),
    ).not.toBeInTheDocument();
    view.unmount();
    view.client.clear();
  });
  it("не показывает классификацию и доказательства предыдущего артефакта", async () => {
    const view = mount("99999999-9999-4999-8999-999999999999");
    await screen.findByText("Результаты появятся после чтения документов.");
    expect(
      screen.queryByText("ПД — проектная документация"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("ПРОЕКТНАЯ ДОКУМЕНТАЦИЯ"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Повторить классификацию: synthetic.xml",
      }),
    ).not.toBeInTheDocument();
    expect(view.onEvidence).not.toHaveBeenCalled();
    view.unmount();
    view.client.clear();
  });
  it("после потери ответа повторяет тот же запрос классификации и скрывает текст ошибки провайдера", async () => {
    vi.mocked(retryClassification)
      .mockRejectedValueOnce(new Error("secret-provider-payload"))
      .mockImplementation(({ requestId }) =>
        Promise.resolve({
          request_id: requestId,
          task_id: classifiedFile.task_id!,
        }),
      );
    const view = mount();
    const button = await screen.findByRole("button", {
      name: "Повторить классификацию: synthetic.xml",
    });
    fireEvent.click(button);
    await screen.findByRole("alert");
    expect(
      screen.queryByText(/secret-provider-payload/),
    ).not.toBeInTheDocument();
    fireEvent.click(button);
    await waitFor(() => expect(retryClassification).toHaveBeenCalledTimes(2));
    expect(vi.mocked(retryClassification).mock.calls[1]?.[0]).toEqual(
      vi.mocked(retryClassification).mock.calls[0]?.[0],
    );
    expect(vi.mocked(retryClassification).mock.calls[0]?.[0]).toMatchObject({
      objectId: parsingObjectId,
      fileId: classifiedFile.file_id,
    });
    await screen.findByText("Запрос классификации принят.");
    view.unmount();
    view.client.clear();
  });
});
