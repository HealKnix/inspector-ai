import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";

import { getParseResult, getRenderedPage } from "@/api/endpoints/parsing";
import {
  parsedFile,
  parseResult,
  parsingObjectId,
} from "@/api/types/parsing-test-fixtures";
import { DocumentViewer } from "./DocumentViewer";

vi.mock("@/api/endpoints/parsing", () => ({
  getParseResult: vi.fn(),
  getRenderedPage: vi.fn(),
}));
const revokeUrl = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  URL.createObjectURL = vi.fn(() => "blob:synthetic-protected-page");
  URL.revokeObjectURL = revokeUrl;
  vi.mocked(getParseResult).mockResolvedValue(structuredClone(parseResult));
  vi.mocked(getRenderedPage).mockResolvedValue(
    new Blob(["synthetic"], { type: "image/png" }),
  );
});

function mount(sourceHash = "a".repeat(64)) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const onPage = vi.fn();
  function StatefulViewer() {
    const [page, setPage] = useState(1);
    return (
      <DocumentViewer
        objectId={parsingObjectId}
        file={parsedFile}
        sourceFormat="XML"
        sourceHash={sourceHash}
        pageNumber={page}
        onPage={(next) => {
          onPage(next);
          setPage(next);
        }}
        onClose={vi.fn()}
      />
    );
  }
  const view = render(
    <QueryClientProvider client={client}>
      <StatefulViewer />
    </QueryClientProvider>,
  );
  return { ...view, client, onPage };
}

describe("document viewer", () => {
  it("не создаёт фокусируемые фрагменты для пустого OCR, сохраняя пустые ячейки таблиц", async () => {
    const result = structuredClone(parseResult);
    const base = result.artifact.pages[0]!.blocks[0]!;
    result.artifact.pages[0]!.blocks = [
      {
        ...base,
        id: "empty-ocr",
        source: "ocr",
        raw_text: " \n\t",
        normalized_text: "",
      },
      {
        ...base,
        id: "empty-cell",
        order: 1,
        kind: "table_cell",
        source: "ocr",
        raw_text: "",
        normalized_text: "",
        table_id: "empty-table",
        row: 0,
        column: 0,
        row_span: 1,
        column_span: 1,
      },
    ];
    vi.mocked(getParseResult).mockResolvedValue(result);
    const view = mount();
    await screen.findByRole("img");
    expect(
      screen.queryByRole("button", { name: /^Фрагмент 1:/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Фрагмент 2:/ }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Пустой фрагмент" }),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Таблицы" }));
    expect(
      screen.getByRole("button", {
        name: /строка 1, столбец 1: Пустая ячейка/,
      }),
    ).toBeInTheDocument();
    view.unmount();
    view.client.clear();
  });
  it("сохраняет весь текст, безопасно показывает объединённые ячейки и переходит к оригиналу на другой странице", async () => {
    const result = structuredClone(parseResult);
    const first = result.artifact.pages[0]!;
    const base = first.blocks[0]!;
    const markup = '<img src=x onerror="alert(1)">';
    first.blocks = [
      {
        ...base,
        id: "header",
        normalized_text: "Шапка документа",
        source: "ocr",
        structural_path: "ocr/overall/line[0]",
      },
      {
        ...base,
        id: "merged",
        order: 1,
        kind: "table_cell",
        table_id: "table",
        row: 0,
        column: 0,
        row_span: 2,
        column_span: 2,
        raw_text: markup,
        normalized_text: markup,
      },
    ];
    const second = {
      ...structuredClone(first),
      page_number: 2,
      blocks: [
        {
          ...first.blocks[1]!,
          id: "total",
          row_span: 1,
          column_span: 1,
          raw_text: "Итого  12",
          normalized_text: "Итого 12",
        },
      ],
    };
    result.artifact.pages.push(second);
    result.artifact.coverage = {
      total_pages: 2,
      readable_pages: 2,
      unreadable_pages: 0,
    };
    result.artifact.versions = {
      ocr_engine: "PP-StructureV3",
      paddleocr: "3.7.0",
    };
    result.artifact.reasons = [
      "OCR_TABLE_TEXT_DIFFERENCE",
      "NEW_PROCESSOR_LIMIT",
    ];
    result.artifact.normalized_text =
      "Шапка документа\nИтого 12\nЗаключение инженера";
    result.artifact.raw_text =
      "Шапка  документа\nИтого  12\nЗаключение  инженера";
    vi.mocked(getParseResult).mockResolvedValue(result);
    const view = mount();
    await screen.findByRole("img");
    expect(
      screen.getByText(
        /Движок распознавания: PP-StructureV3 · PaddleOCR 3.7.0/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Текст ячеек отличается от общего распознавания/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/дополнительное ограничение: NEW_PROCESSOR_LIMIT/),
    ).toBeInTheDocument();
    expect(screen.getByText("Текст страницы · OCR")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Весь документ" }));
    expect(screen.getByLabelText("Полный текст документа").textContent).toBe(
      result.artifact.normalized_text,
    );
    fireEvent.click(screen.getByRole("button", { name: "Исходный" }));
    expect(screen.getByLabelText("Полный текст документа").textContent).toBe(
      result.artifact.raw_text,
    );
    fireEvent.click(screen.getByRole("button", { name: "Таблицы" }));
    const table = screen.getByRole("table", { name: "Таблица 1 · страница 1" });
    const merged = within(table).getByRole("cell");
    expect(merged).toHaveAttribute("rowspan", "2");
    expect(merged).toHaveAttribute("colspan", "2");
    expect(merged.textContent).toBe(markup);
    expect(table.querySelector("img")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Страница 2, строка 1, столбец 1: Итого 12",
      }),
    );
    expect(view.onPage).toHaveBeenCalledWith(2);
    await screen.findByRole("img", {
      name: "Страница 2 документа synthetic.xml",
    });
    expect(
      screen.getByRole("button", { name: "Фрагмент 2: Итого 12" }),
    ).toHaveAttribute("aria-pressed", "true");
    view.unmount();
    view.client.clear();
  });
  it("сохраняет ячейки старой противоречивой сетки списком и показывает фактический старый движок", async () => {
    const result = structuredClone(parseResult);
    const base = result.artifact.pages[0]!.blocks[0]!;
    result.artifact.versions.ocr_engine = "PaddleOCR";
    result.artifact.pages[0]!.blocks = [
      "Первый фрагмент",
      "Второй фрагмент",
    ].map((text, index) => ({
      ...base,
      id: `legacy-${index}`,
      kind: "table_cell",
      normalized_text: text,
      table_id: "legacy",
      row: 0,
      column: 0,
      row_span: 1,
      column_span: 1,
    }));
    vi.mocked(getParseResult).mockResolvedValue(result);
    const view = mount();
    await screen.findByRole("img");
    expect(
      screen.getByText("Движок распознавания: PaddleOCR"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Таблицы" }));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Все извлечённые ячейки сохранены ниже списком/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: /строка 1, столбец 1: Второй фрагмент/,
      }),
    );
    expect(
      screen.getByRole("button", { name: "Фрагмент 1: Второй фрагмент" }),
    ).toHaveAttribute("aria-pressed", "true");
    view.unmount();
    view.client.clear();
  });
  it("показывает выбранный фрагмент после загрузки PNG и при изменении масштаба", async () => {
    const previous = Object.getOwnPropertyDescriptor(
      Element.prototype,
      "scrollIntoView",
    );
    const scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    let completeImage: ((blob: Blob) => void) | undefined;
    vi.mocked(getRenderedPage).mockReturnValue(
      new Promise((resolve) => {
        completeImage = resolve;
      }),
    );
    const view = mount();
    try {
      fireEvent.click(await screen.findByRole("button", { name: "Шифр А-12" }));
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
      scrollIntoView.mockClear();
      await act(() => {
        completeImage?.(new Blob(["synthetic"], { type: "image/png" }));
        return Promise.resolve();
      });
      await screen.findByRole("img");
      expect(scrollIntoView).toHaveBeenLastCalledWith({
        block: "center",
        inline: "center",
      });
      scrollIntoView.mockClear();
      fireEvent.click(
        screen.getByRole("button", { name: "Увеличить масштаб" }),
      );
      expect(scrollIntoView).toHaveBeenLastCalledWith({
        block: "center",
        inline: "center",
      });
    } finally {
      view.unmount();
      view.client.clear();
      if (previous)
        Object.defineProperty(Element.prototype, "scrollIntoView", previous);
      else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    }
  });
  it("совмещает bbox с видимой PNG, сохраняет выделение при масштабе и освобождает blob", async () => {
    const { unmount, client } = mount();
    const image = await screen.findByRole("img", {
      name: "Страница 1 документа synthetic.xml",
    });
    expect(image).toHaveAttribute("src", "blob:synthetic-protected-page");
    const fragment = screen.getByRole("button", {
      name: "Фрагмент 1: Шифр А-12",
    });
    expect(fragment.style.left).toBe("10%");
    expect(fragment.style.top).toBe("20%");
    expect(parseFloat(fragment.style.width)).toBeCloseTo(30);
    expect(parseFloat(fragment.style.height)).toBeCloseTo(5);
    fireEvent.click(fragment);
    expect(fragment).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("/document/code")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Увеличить масштаб" }));
    expect(image.parentElement).toHaveStyle({ width: "1000px" });
    expect(fragment.style.left).toBe("10%");
    expect(fragment).toHaveAttribute("aria-pressed", "true");
    unmount();
    client.clear();
    expect(revokeUrl).toHaveBeenCalledWith("blob:synthetic-protected-page");
  });
  it("ищет нормализованный и исходный текст и показывает качество отдельно от проверки", async () => {
    const { unmount, client, onPage } = mount();
    await screen.findByRole("img");
    expect(
      screen.getByText("Представление содержимого и извлечённый текст"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Страниц с прочитанным текстом: 1 из 1/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Качество относится к распознаванию/),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "А-12" },
    });
    expect(screen.getByText("Фрагментов: 1")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Следующее совпадение" }),
    );
    expect(onPage).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "Исходный" }));
    expect(screen.getByRole("button", { name: "Шифр А-12" }).textContent).toBe(
      "Шифр  А-12",
    );
    expect(screen.queryByText("READY")).not.toBeInTheDocument();
    unmount();
    client.clear();
  });
  it("не показывает текст и изображение другого оригинала", async () => {
    const { unmount, client } = mount("c".repeat(64));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Результат не соответствует оригиналу",
      ),
    );
    expect(getRenderedPage).not.toHaveBeenCalled();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByText("Шифр А-12")).not.toBeInTheDocument();
    unmount();
    client.clear();
  });
});
