import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import { AppProviders } from "@/components/AppProviders";

import { VerificationPage } from "./VerificationPage";

function renderPage() {
  return render(
    <AppProviders>
      <VerificationPage />
    </AppProviders>,
  );
}

function getFindingButtons() {
  return screen.getAllByRole("button", {
    name: /^Открыть расхождение \d+:/,
  });
}

describe("VerificationPage", () => {
  it("показывает демонстрационный комплект и учитывает правки к референсу", () => {
    renderPage();

    expect(
      screen.getByRole("heading", {
        name: "Проверка комплекта документов",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("ДЕМО")).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Список расхождений" }),
    ).toBeInTheDocument();
    expect(screen.getByText("18 из 47")).toBeInTheDocument();
    expect(screen.getByText("Все 47")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Рекомендации" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Сформировать протокол" }),
    ).toBeDisabled();
    expect(
      screen.getByText("Осталось обработать расхождений: 29."),
    ).toBeInTheDocument();

    expect(screen.queryByText("Сравнивать с:")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Экспорт PDF" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "JSON/XML" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "К списку разделов" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Найденные расхождения" }),
    ).not.toBeInTheDocument();
  });

  it("переключает ПД, РД и ИД независимо в каждом окне просмотра", async () => {
    renderPage();

    const referenceSelector = screen.getByLabelText(
      "Массив документов: Эталон (демо)",
    );
    const actualSelector = screen.getByLabelText(
      "Массив документов: Факт (демо)",
    );

    expect(
      screen.getByRole("heading", {
        name: "Эталон: проектная документация (демо)",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Проверяемая рабочая документация (демо)",
      }),
    ).toBeInTheDocument();

    const referenceIdTab = within(referenceSelector).getByRole("radio", {
      name: "ИД",
    });
    referenceIdTab.focus();
    fireEvent.click(referenceIdTab);

    expect(
      await screen.findByRole("heading", {
        name: "Эталон: исполнительная документация (демо)",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Проверяемая рабочая документация (демо)",
      }),
    ).toBeInTheDocument();
    expect(referenceIdTab).toHaveFocus();

    fireEvent.click(within(actualSelector).getByRole("radio", { name: "ПД" }));

    expect(
      await screen.findByRole("heading", {
        name: "Проверяемая проектная документация (демо)",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Эталон: исполнительная документация (демо)",
      }),
    ).toBeInTheDocument();
  });

  it("переключает страницы и масштаб выбранного документа", () => {
    renderPage();

    const referencePane = screen.getByLabelText(
      "Эталон (демо): просмотр документа",
    );
    fireEvent.click(
      within(referencePane).getByRole("button", {
        name: "Следующая страница",
      }),
    );

    expect(
      within(referencePane).getByText(
        "Открыта страница 2. Фрагмент выбранного расхождения находится на странице 1.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      within(referencePane).getByRole("button", {
        name: "Увеличить масштаб",
      }),
    );
    expect(within(referencePane).getByText("125%")).toBeInTheDocument();
  });

  it("ищет, фильтрует и открывает выбранное расхождение", async () => {
    renderPage();

    expect(getFindingButtons()).toHaveLength(47);

    const searchInput = screen.getByPlaceholderText("Поиск по расхождениям…");
    fireEvent.change(searchInput, {
      target: { value: "Номер протокола испытаний" },
    });

    await waitFor(() => {
      expect(getFindingButtons()).toHaveLength(1);
    });
    expect(
      screen.getByRole("button", {
        name: "Открыть расхождение 38: Номер протокола испытаний отличается",
      }),
    ).toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: "" } });
    await waitFor(() => {
      expect(getFindingButtons()).toHaveLength(47);
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Открыть расхождение 3: Шифр в штампе отличается",
      }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "Шифр в штампе отличается",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Эталон: исполнительная документация (демо)",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Проверяемая проектная документация (демо)",
      }),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByLabelText("Эталон (демо): просмотр документа"),
      ).getByText("ДЕМО-25-0173"),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByLabelText("Факт (демо): просмотр документа"),
      ).getByText("ДЕМО-25-0173-КР"),
    ).toBeInTheDocument();

    const filters = screen.getByLabelText("Фильтр расхождений");
    fireEvent.click(within(filters).getByText("Внимание 9"));

    await waitFor(() => {
      expect(getFindingButtons()).toHaveLength(9);
    });
    expect(
      screen.queryByRole("button", {
        name: "Открыть расхождение 3: Шифр в штампе отличается",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Эталон: проектная документация (демо)",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "Проверяемая рабочая документация (демо)",
      }),
    ).toBeInTheDocument();
  });

  it("валидирует локальное отклонение и увеличивает число обработанных", async () => {
    renderPage();

    expect(screen.getByText("18 из 47")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Отклонить" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Сохранить демо-решение" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Для решения нужен комментарий.",
    );

    fireEvent.change(
      screen.getByRole("textbox", { name: "Комментарий инспектора" }),
      { target: { value: "Доказательства сопоставлены инспектором." } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Сохранить демо-решение" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "необходимо указать причину",
    );

    fireEvent.click(
      screen.getByRole("radio", {
        name: "Актуальная редакция выбрана неверно",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Сохранить демо-решение" }),
    );

    await waitFor(() => {
      expect(screen.getByText("19 из 47")).toBeInTheDocument();
    });
    // Решённая находка доступна только для возврата в работу —
    // фокус переходит на оставшееся действие.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Вернуть в работу" }),
      ).toHaveFocus();
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Демонстрационное решение применено только в памяти этой страницы.",
    );

    fireEvent.click(screen.getByRole("tab", { name: "Обоснование" }));
    expect(
      screen.getByText("Причина: Актуальная редакция выбрана неверно"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Комментарий: Доказательства сопоставлены инспектором."),
    ).toBeInTheDocument();
  });

  it("подставляет сохранённое основание при повторной проверке решения", async () => {
    renderPage();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Открыть расхождение 2: Несоответствие веса",
      }),
    );
    // Решённая находка возвращается в работу только через reopen —
    // прямого повторного отклонения у контракта нет.
    fireEvent.click(screen.getByRole("button", { name: "Вернуть в работу" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Комментарий инспектора" }),
      { target: { value: "Возвращаю для повторной проверки." } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Сохранить демо-решение" }),
    );

    fireEvent.click(await screen.findByRole("button", { name: "Отклонить" }));

    expect(
      screen.getByRole("radio", { name: "Ошибка привязки доказательства" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("textbox", { name: "Комментарий инспектора" }),
    ).toHaveValue("Возвращаю для повторной проверки.");
  });

  it("сохраняет фокус при переходе к следующему расхождению", () => {
    renderPage();

    const nextButton = screen.getByRole("button", {
      name: "Следующее расхождение",
    });
    nextButton.focus();
    fireEvent.click(nextButton);

    expect(nextButton).toHaveFocus();
    expect(
      screen.getByRole("heading", { name: "Расходится размер между осями" }),
    ).toBeInTheDocument();
  });
});
