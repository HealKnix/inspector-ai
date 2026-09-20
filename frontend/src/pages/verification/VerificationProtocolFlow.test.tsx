import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { mockProtocols } from "@/data/protocols";
import { useProtocolStore } from "@/store/protocols";

import { VerificationPage } from "./VerificationPage";

vi.mock("@/data/verification", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/verification")>();

  return {
    ...actual,
    mockVerificationPackage: {
      ...actual.mockVerificationPackage,
      findings: actual.mockVerificationPackage.findings.map((finding) =>
        finding.findingStatus === "CANDIDATE"
          ? {
              ...finding,
              findingStatus: "CONFIRMED_VIOLATION" as const,
              reviewComment: "Синтетическое решение для теста маршрута.",
            }
          : finding,
      ),
    },
  };
});

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

describe("формирование mock-протокола из проверки", () => {
  beforeEach(() => {
    useProtocolStore.setState({ protocols: [...mockProtocols] });
  });

  it("создаёт снимок после обработки всех расхождений и открывает его", () => {
    render(
      <MemoryRouter initialEntries={["/verification"]}>
        <Routes>
          <Route element={<VerificationPage />} path="/verification" />
          <Route element={<LocationProbe />} path="/protocols/:protocolId" />
        </Routes>
      </MemoryRouter>,
    );

    const createButton = screen.getByRole("button", {
      name: "Сформировать протокол",
    });
    expect(createButton).toBeEnabled();

    fireEvent.click(createButton);

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/protocols/synthetic-demo-created-protocol-1",
    );
    expect(useProtocolStore.getState().protocols[0]).toMatchObject({
      id: "synthetic-demo-created-protocol-1",
      objectName: "Демонстрационный объект «Северный»",
    });
  });
});
