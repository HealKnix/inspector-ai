import { generateExpectedPackage } from "@/api/endpoints/completeness";
import { createObject, listObjects } from "@/api/endpoints/objects";
import routeNames from "@/routes/routeNames";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ObjectsPage } from "./ObjectsPage";

vi.mock("@/api/endpoints/objects", () => ({
  createObject: vi.fn(),
  listObjects: vi.fn(),
}));
vi.mock("@/api/endpoints/completeness", () => ({
  getExpectedPackage: vi.fn(),
  generateExpectedPackage: vi.fn(),
  confirmExpectedPackage: vi.fn(),
  evaluateCompleteness: vi.fn(),
  getCompletenessResult: vi.fn(),
}));
afterEach(() => vi.clearAllMocks());
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[routeNames.OBJECTS]}>
        <Routes>
          <Route path={routeNames.OBJECTS} element={<ObjectsPage />} />
          <Route
            path={routeNames.OBJECT_UPLOAD(":objectId")}
            element={<p>Страница загрузки созданного объекта</p>}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
describe("object entry point", () => {
  it("creates an object from an empty list and opens its card without entering UUID", async () => {
    vi.mocked(listObjects).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      allowed_actions: ["create"],
    });
    vi.mocked(createObject).mockResolvedValue({
      id: "84831c2d-9aad-4b60-9bea-4caed0a19a53",
      name: "Корпус 1",
      created_by: "synthetic",
      created_at: "2026-09-17T00:00:00.000Z",
      updated_at: "2026-09-17T00:00:00.000Z",
      allowed_actions: ["upload"],
    });
    mount();
    expect(await screen.findByText("Пока нет объектов")).toBeInTheDocument();
    fireEvent.change(
      screen.getByRole("textbox", { name: /Название объекта/ }),
      { target: { value: "  Корпус 1  " } },
    );
    vi.mocked(generateExpectedPackage).mockResolvedValue({
      schema_version: 1,
      object_id: "84831c2d-9aad-4b60-9bea-4caed0a19a53",
      package_version: 1,
      status: "proposed",
      requirements: 35,
      list_items: 0,
      extracted_candidates: 0,
    });
    fireEvent.click(screen.getByRole("button", { name: "Создать объект" }));
    await waitFor(() =>
      expect(createObject).toHaveBeenCalledWith("Корпус 1", expect.anything()),
    );
    await waitFor(() =>
      expect(generateExpectedPackage).toHaveBeenCalledWith({
        objectId: "84831c2d-9aad-4b60-9bea-4caed0a19a53",
        attributes: {},
      }),
    );
    expect(
      await screen.findByText("Страница загрузки созданного объекта"),
    ).toBeInTheDocument();
  });
  it("does not expose creation when the API denies the action", async () => {
    vi.mocked(listObjects).mockRejectedValue(
      new Error("Нет разрешения на работу с объектами"),
    );
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Нет разрешения",
    );
    expect(
      screen.queryByRole("button", { name: "Создать объект" }),
    ).not.toBeInTheDocument();
  });
});
