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
  createRegionalParseResult,
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
  it.each(["unconfirmed", "unreadable"] as const)(
    "не дублирует общий статус OCR-таблицы %s и сохраняет конкретное ограничение",
    async (status) => {
      const result = createRegionalParseResult();
      const page = result.artifact.pages[0]!;
      page.blocks = page.blocks.filter((block) => block.kind !== "table_cell");
      Object.assign(page.regions![3]!, {
        method: "table_ocr",
        table_status: status,
        reasons: [
          "TABLE_STRUCTURE_UNAVAILABLE",
          "TABLE_STRUCTURE_REJECTED",
          "TABLE_STRUCTURE_UNVERIFIED",
          "OCR_LOW_CONFIDENCE",
        ],
      });
      vi.mocked(getParseResult).mockResolvedValue(result);
      const view = mount();
      await screen.findByRole("img");
      fireEvent.click(screen.getByRole("button", { name: "Области" }));
      fireEvent.click(
        screen.getByRole("button", { name: "Область 4: Таблица" }),
      );
      const region = within(
        screen.getByLabelText("Содержимое выбранной области"),
      );
      expect(region.getByText("Распознавание таблицы")).toBeVisible();
      expect(
        region.getByText(
          status === "unconfirmed"
            ? /Структура таблицы не подтверждена/
            : /Не удалось прочитать содержимое таблицы/,
        ),
      ).toBeVisible();
      expect(
        region.getByText("Есть неуверенно распознанные фрагменты"),
      ).toBeVisible();
      expect(
        region.queryByText(/Структуру таблицы восстановить не удалось/),
      ).not.toBeInTheDocument();
      expect(
        region.queryByText(/Структуру таблицы не удалось восстановить надёжно/),
      ).not.toBeInTheDocument();
      expect(
        region.queryByText(/Структура таблиц требует проверки/),
      ).not.toBeInTheDocument();
      expect(region.queryByText(/без повторного OCR/)).not.toBeInTheDocument();
      view.unmount();
      view.client.clear();
    },
  );
  it("сворачивает общие ограничения регионального результата и показывает причины в выбранной области", async () => {
    const result = createRegionalParseResult();
    result.artifact.quality = result.artifact.pages[0]!.quality = "LOW_QUALITY";
    result.artifact.reasons = result.artifact.pages[0]!.reasons = [
      "LAYOUT_REGIONS_UNCERTAIN",
      "OCR_UNVERIFIED",
    ];
    result.artifact.pages[0]!.regions![2]!.reasons = ["LAYOUT_LOW_CONFIDENCE"];
    vi.mocked(getParseResult).mockResolvedValue(result);
    const view = mount();
    await screen.findByRole("img");
    expect(screen.getByText("Часть областей требует проверки")).toBeVisible();
    for (const warning of screen.getAllByText(
      "Распознанный текст требует проверки",
    ))
      expect(warning).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Области" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Область 3: Неопределённая область" }),
    );
    expect(
      screen.getByText("Недостаточно уверенности в типе области; OCR пропущен"),
    ).toBeVisible();
    view.unmount();
    view.client.clear();
  });
  it("показывает области, исключает надписи графики из основных фрагментов и поиска, сохраняя доступ к ним", async () => {
    vi.mocked(getParseResult).mockResolvedValue(createRegionalParseResult());
    const view = mount();
    await screen.findByRole("img");
    expect(
      screen.queryByRole("button", { name: "Размер −250" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Фрагмент 2:/ }),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "−250" },
    });
    expect(screen.getByText("Совпадений нет")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Области" }));
    const overlay = screen.getByRole("button", {
      name: "Область 2: Графическая область",
    });
    expect(overlay.style.left).toBe("5%");
    expect(overlay.style.top).toBe("35%");
    fireEvent.click(overlay);
    expect(overlay).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByText(/Графическая область сохранена для отдельного анализа/),
    ).toBeInTheDocument();
    expect(screen.getByText("Размер −250")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /^3. Неопределённая область/ }),
    );
    expect(
      screen.getByText(/Тип области определить не удалось/),
    ).toBeInTheDocument();
    expect(screen.getByText("Неопределённая подпись")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Область 4: Таблица" }));
    expect(
      within(screen.getByLabelText("Содержимое выбранной области")).getByRole(
        "button",
        { name: /Пустая ячейка/ },
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Весь документ" }));
    expect(screen.getByLabelText("Полный текст документа")).toHaveTextContent(
      "Размер −250",
    );
    expect(
      screen.getByText(/Полный текст включает сохранённые надписи/),
    ).toBeInTheDocument();
    view.unmount();
    view.client.clear();
  });
  it("различает отсутствующую, неподтверждённую и непрочитанную таблицу", async () => {
    const result = createRegionalParseResult();
    const page = result.artifact.pages[0]!;
    page.regions![3]!.table_status = "unconfirmed";
    page.blocks = page.blocks.filter((block) => block.kind !== "table_cell");
    page.regions!.push({
      ...page.regions![3]!,
      id: "unreadable-table",
      table_status: "unreadable",
    });
    vi.mocked(getParseResult).mockResolvedValue(result);
    const view = mount();
    await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "Таблицы" }));
    expect(
      screen.getByText(/Структура таблицы не подтверждена/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Не удалось прочитать содержимое таблицы/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Табличные области не найдены/),
    ).not.toBeInTheDocument();
    view.unmount();
    view.client.clear();
    const withoutTables = createRegionalParseResult();
    withoutTables.artifact.pages[0]!.regions =
      withoutTables.artifact.pages[0]!.regions!.filter(
        (region) => region.kind !== "table",
      );
    withoutTables.artifact.pages[0]!.blocks =
      withoutTables.artifact.pages[0]!.blocks.filter(
        (block) => block.kind !== "table_cell",
      );
    vi.mocked(getParseResult).mockResolvedValue(withoutTables);
    const next = mount();
    await screen.findByRole("img");
    fireEvent.click(screen.getByRole("button", { name: "Таблицы" }));
    expect(
      screen.getByText(/Табличные области не найдены/),
    ).toBeInTheDocument();
    next.unmount();
    next.client.clear();
  });
  it("объясняет отсутствие разметки областей в старом результате", async () => {
    const view = mount();
    await screen.findByRole("img");
    expect(
      screen.getByText(
        "Разметка областей для этого результата не выполнялась.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Области" }));
    expect(
      screen.queryByRole("button", { name: /^Область 1:/ }),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByLabelText("Области страницы")).getByText(
        /Разметка областей/,
      ),
    ).toBeInTheDocument();
    view.unmount();
    view.client.clear();
  });
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
