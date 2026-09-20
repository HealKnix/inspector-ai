import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";

import { mockProtocols } from "@/data/protocols";
import routeNames from "@/routes/routeNames";
import { useProtocolStore } from "@/store/protocols";

import { ProtocolsPage } from "./ProtocolsPage";

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">{`${location.pathname}${location.search}`}</output>
  );
}

function DetailsProbe() {
  const { protocolId } = useParams();
  return <p>Открыт протокол {protocolId}</p>;
}

function renderPage(initialEntry: string = routeNames.PROTOCOLS) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route element={<ProtocolsPage />} path={routeNames.PROTOCOLS} />
        <Route
          element={<DetailsProbe />}
          path={routeNames.PROTOCOL_DETAILS(":protocolId")}
        />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useProtocolStore.setState({ protocols: [...mockProtocols] });
});

describe("ProtocolsPage", () => {
  it("показывает синтетические протоколы в таблице и мобильном списке", () => {
    renderPage();

    expect(
      screen.getByRole("heading", { name: "Протоколы", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText("ДЕМО")).toBeVisible();
    expect(screen.getByText("3 из 3")).toBeInTheDocument();
    const table = screen.getByRole("grid", { name: "Протоколы проверок" });
    expect(table).toBeInTheDocument();
    expect(
      within(table).getByRole("columnheader", { name: "Нарушения" }),
    ).toBeInTheDocument();
    expect(
      within(table).queryByRole("columnheader", { name: "Несоответствия" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByText(`${mockProtocols[0].violations.length} нарушений`),
    ).not.toHaveLength(0);
    expect(
      screen.getAllByText("Демонстрационный объект «Северный»"),
    ).not.toHaveLength(0);
    expect(
      screen.getAllByText("Демонстрационный объект «Речной»"),
    ).not.toHaveLength(0);
  });

  it("восстанавливает фильтр объекта и поиск из URL", () => {
    renderPage(
      `${routeNames.PROTOCOLS}?objectId=synthetic-demo-object-north&q=18.09.2026`,
    );

    expect(screen.getByText("1 из 3")).toBeInTheDocument();
    expect(screen.getAllByText("Протокол от 18.09.2026")).not.toHaveLength(0);
    expect(
      within(
        screen.getByRole("grid", { name: "Протоколы проверок" }),
      ).queryByText("Демонстрационный объект «Речной»"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Поиск" })).toHaveValue(
      "18.09.2026",
    );
  });

  it("обновляет поисковый параметр и фильтрует список", async () => {
    renderPage();

    fireEvent.change(screen.getByRole("searchbox", { name: "Поиск" }), {
      target: { value: "Речной" },
    });

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `${routeNames.PROTOCOLS}?q=%D0%A0%D0%B5%D1%87%D0%BD%D0%BE%D0%B9`,
      );
    });
    expect(screen.getByText("1 из 3")).toBeInTheDocument();
    expect(
      screen.queryByText("Протокол от 18.09.2026"),
    ).not.toBeInTheDocument();
  });

  it("выбирает объект и записывает его идентификатор в URL", async () => {
    renderPage();

    fireEvent.click(
      screen.getByRole("button", { name: /Все объекты.*Объект/ }),
    );
    fireEvent.click(
      await screen.findByRole("option", {
        name: "Демонстрационный объект «Речной»",
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        `${routeNames.PROTOCOLS}?objectId=synthetic-demo-object-river`,
      );
    });
    expect(screen.getByText("1 из 3")).toBeInTheDocument();
  });

  it("открывает detail выбранного протокола", async () => {
    renderPage();
    const protocol = mockProtocols[0];

    const row = screen.getByRole("row", {
      name: "Протокол от 18.09.2026",
    });
    fireEvent.click(row);

    expect(
      await screen.findByText(`Открыт протокол ${protocol.id}`),
    ).toBeInTheDocument();
  });
});
