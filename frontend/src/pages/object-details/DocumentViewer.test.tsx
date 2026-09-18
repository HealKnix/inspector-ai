import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

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
  const view = render(
    <QueryClientProvider client={client}>
      <DocumentViewer
        objectId={parsingObjectId}
        file={parsedFile}
        sourceFormat="XML"
        sourceHash={sourceHash}
        pageNumber={1}
        onPage={onPage}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { ...view, client, onPage };
}

describe("document viewer", () => {
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
