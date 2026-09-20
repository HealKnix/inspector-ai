import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { mockProtocols } from "@/data/protocols";
import routeNames from "@/routes/routeNames";
import { useProtocolStore } from "@/store/protocols";

import { ProtocolDetailsPage } from "./ProtocolDetailsPage";
import { getProtocolSummary } from "./lib/protocols";

function renderPage(protocolId: string) {
  return render(
    <MemoryRouter initialEntries={[routeNames.PROTOCOL_DETAILS(protocolId)]}>
      <Routes>
        <Route
          element={<ProtocolDetailsPage />}
          path={routeNames.PROTOCOL_DETAILS(":protocolId")}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useProtocolStore.setState({ protocols: [...mockProtocols] });
});

describe("ProtocolDetailsPage", () => {
  it("показывает протокол с двумя запрошенными полями метаданных", () => {
    const protocol = mockProtocols[0];
    renderPage(protocol.id);

    expect(
      screen.getByRole("heading", { name: "Протокол", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Сформирован")).toBeInTheDocument();
    expect(screen.getByText("ДЕМО")).toBeVisible();

    const metadata = screen.getByLabelText("Сведения о протоколе");
    expect(within(metadata).getByText("Объект")).toBeInTheDocument();
    expect(within(metadata).getByText(protocol.objectName)).toBeInTheDocument();
    expect(within(metadata).getByText("Дата проверки")).toBeInTheDocument();
    expect(within(metadata).getByText("18.09.2026")).toBeInTheDocument();
    expect(within(metadata).queryByText("Закупка")).not.toBeInTheDocument();
    expect(within(metadata).queryByText("Раздел")).not.toBeInTheDocument();
    expect(within(metadata).queryByText("Проверяющий")).not.toBeInTheDocument();
  });

  it("показывает одну таблицу с восемью колонками и нарушениями по порядку", () => {
    const protocol = mockProtocols[0];
    renderPage(protocol.id);

    const violationsRegion = screen.getByRole("region", {
      name: "Выявленные нарушения",
    });
    expect(
      screen.getAllByRole("region", { name: "Выявленные нарушения" }),
    ).toHaveLength(1);
    expect(
      within(violationsRegion).getByRole("searchbox", {
        name: "Поиск по нарушениям",
      }),
    ).toBeInTheDocument();

    const table = within(violationsRegion).getByRole("grid", {
      name: "Нарушения протокола",
    });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent?.trim()),
    ).toEqual([
      "№",
      "Раздел",
      "Параметр (код)",
      "ПД",
      "РД",
      "ИД",
      "Отклонение",
      "Решение инспектора",
    ]);

    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(protocol.violations.length);
    expect(
      rows.map((row) =>
        within(row).getAllByRole("gridcell")[0]?.textContent?.trim(),
      ),
    ).toEqual(protocol.violations.map(({ ordinal }) => String(ordinal)));
    expect(rows[0]).toHaveTextContent("✓Подтверждено");
    expect(screen.queryByText(/РАЗДЕЛ 4\./)).not.toBeInTheDocument();
    expect(screen.queryByText(/РАЗДЕЛ 5\./)).not.toBeInTheDocument();
  });

  it("вычисляет итоговую сводку из snapshot нарушений", () => {
    const protocol = mockProtocols[0];
    const expected = getProtocolSummary(protocol.violations);
    renderPage(protocol.id);

    const summary = screen.getByRole("region", { name: "Итоговая сводка" });
    expect(
      within(summary).getByText("Всего").parentElement?.parentElement,
    ).toHaveTextContent(`Всего${expected.totalCount}`);
    expect(
      within(summary).getByText("Критические").parentElement?.parentElement,
    ).toHaveTextContent(`Критические${expected.criticalCount}`);
    expect(
      within(summary).getByText("Существенные").parentElement?.parentElement,
    ).toHaveTextContent(`Существенные${expected.significantCount}`);
    expect(
      within(summary).getByText("Подтверждено").parentElement?.parentElement,
    ).toHaveTextContent(`✓Подтверждено${expected.confirmedCount}`);
  });

  it("ищет по значениям нарушения", () => {
    const protocol = mockProtocols[0];
    const targetViolation = protocol.violations[0]!;
    renderPage(protocol.id);

    fireEvent.change(
      screen.getByRole("searchbox", { name: "Поиск по нарушениям" }),
      { target: { value: targetViolation.code } },
    );

    expect(
      screen.getByText(`Показано 1 из ${protocol.violations.length}`),
    ).toBeInTheDocument();
    expect(screen.getAllByText(targetViolation.parameter)).not.toHaveLength(0);
  });

  it("не имитирует успешную передачу и экспорт", () => {
    renderPage(mockProtocols[0].id);

    fireEvent.click(screen.getByRole("button", { name: "Передать в РиН" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "данные не передавались",
    );

    fireEvent.click(screen.getByRole("button", { name: "Экспорт PDF" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      "PDF-файл не формировался и не скачивался",
    );
  });

  it("показывает безопасное состояние для неизвестного protocolId", () => {
    renderPage("unknown-protocol");

    expect(screen.getByRole("alert")).toHaveTextContent("Протокол не найден");
    expect(
      screen.getByRole("button", { name: "К списку протоколов" }),
    ).toBeInTheDocument();
  });
});
