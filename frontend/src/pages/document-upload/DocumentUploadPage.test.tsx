import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import { AppProviders } from "@/components/AppProviders";

import { DocumentUploadPage } from "./DocumentUploadPage";

function renderPage() {
  return render(
    <AppProviders>
      <DocumentUploadPage />
    </AppProviders>,
  );
}

describe("DocumentUploadPage", () => {
  it("показывает согласованную сводку демонстрационного комплекта", () => {
    renderPage();

    expect(
      screen.getByRole("heading", {
        name: "Загрузка комплекта документов",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Загруженные документы (22)",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("ДЕМО")).toBeVisible();

    const filters = screen.getByLabelText("Фильтр документов");
    expect(within(filters).getByText("Все 22")).toBeInTheDocument();
    expect(within(filters).getByText("ПД 8")).toBeInTheDocument();
    expect(within(filters).getByText("РД 10")).toBeInTheDocument();
    expect(within(filters).getByText("ИД 4")).toBeInTheDocument();
    expect(
      within(filters).getByText("Требуют уточнения 4"),
    ).toBeInTheDocument();

    expect(screen.getByText("18 файлов готовы")).toBeInTheDocument();
    expect(screen.getByText("4 требуют уточнения")).toBeInTheDocument();
  });

  it("фильтрует документы по поиску и состоянию метаданных", async () => {
    renderPage();

    const searchInput = screen.getByPlaceholderText("Поиск по файлам…");
    expect(searchInput).toHaveAccessibleName("Поиск по документам");

    fireEvent.change(searchInput, {
      target: { value: "Исполнительная_схема" },
    });

    await waitFor(() => {
      expect(
        screen.getAllByText("22_Исполнительная_схема_конструкций.xml"),
      ).toHaveLength(2);
    });
    expect(
      screen.queryByText("01_Общая_пояснительная_записка.pdf"),
    ).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: "" } });
    fireEvent.click(
      within(screen.getByLabelText("Фильтр документов")).getByText(
        "Требуют уточнения 4",
      ),
    );

    await waitFor(() => {
      expect(screen.getAllByText("08_Смета_на_строительство.pdf")).toHaveLength(
        2,
      );
      expect(screen.getAllByText("12_Основной_комплект_ЭОМ.pdf")).toHaveLength(
        2,
      );
      expect(
        screen.getAllByText("16_Спецификация_оборудования.docx"),
      ).toHaveLength(2);
      expect(
        screen.getAllByText("22_Исполнительная_схема_конструкций.xml"),
      ).toHaveLength(2);
    });
    expect(
      screen.queryByText("01_Общая_пояснительная_записка.pdf"),
    ).not.toBeInTheDocument();
  });

  it("очищает список и показывает пустое состояние", async () => {
    renderPage();

    expect(
      screen.getByText("Для 6 контрольных параметров"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Очистить список" }));

    expect(
      await screen.findByRole("heading", {
        name: "Загруженные документы (0)",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Документы не найдены")).toHaveLength(2);
    expect(
      screen.queryByText("Для 6 контрольных параметров"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Добавьте документы для предварительной оценки состава.",
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Нет файлов")).toHaveLength(3);
    expect(
      screen.getByRole("button", { name: "Очистить список" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Проверить метаданные" }),
    ).toBeDisabled();
  });

  it("добавляет поддерживаемый файл и сообщает о неподдерживаемом", async () => {
    const { container } = renderPage();
    const fileInput = container.querySelector<HTMLInputElement>(
      'input[type="file"]:not([webkitdirectory])',
    );

    expect(fileInput).not.toBeNull();
    if (!fileInput) return;

    const validFile = new File(["valid"], "23_Новый_раздел.pdf", {
      lastModified: 1_790_000_000_000,
      type: "application/pdf",
    });
    fireEvent.change(fileInput, { target: { files: [validFile] } });

    expect(
      await screen.findByRole("heading", {
        name: "Загруженные документы (23)",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(validFile.name)).toHaveLength(2);
    expect(screen.getByText("5 требуют уточнения")).toBeInTheDocument();
    expect(
      screen.queryByText("Для 6 контрольных параметров"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "Источники для контрольных параметров будут оценены после обработки.",
      ),
    ).toBeInTheDocument();

    const invalidFile = new File(["invalid"], "описание.txt", {
      type: "text/plain",
    });
    fireEvent.change(fileInput, { target: { files: [invalidFile] } });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "имеет неподдерживаемый формат",
    );
    expect(
      screen.getByRole("heading", {
        name: "Загруженные документы (23)",
      }),
    ).toBeInTheDocument();
  });
});
