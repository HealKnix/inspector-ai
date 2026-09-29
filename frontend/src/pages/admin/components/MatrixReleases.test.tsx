import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MatrixReleases } from "./MatrixReleases";
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/api/client", () => ({ apiClient: api }));
const id = "11111111-1111-4111-8111-111111111111";
const release = {
  id,
  manifestHash: "a".repeat(64),
  createdAt: "2026-09-27T00:00:00Z",
  createdBy: "synthetic",
  manifest: {
    schema_version: 1,
    mode: "partial",
    catalog: null,
    engines: { comparison: "synthetic" },
    entries: [{ parameter_code: "P019", rule_version_id: id, version: 1 }],
    omitted_parameter_codes: ["P001"],
  },
};
function mount(releases: unknown[] = []) {
  api.get.mockResolvedValue({
    data: { schema_version: 1, active_release_id: null, releases },
  });
  api.post.mockResolvedValue({ data: { release } });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MatrixReleases
        selected={[{ id, parameterCode: "P019", version: 1 }]}
        onRemove={() => {}}
      />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});
it("builds an explicitly selected partial batch without publishing and refuses full mode with missing rows", async () => {
  mount();
  fireEvent.click(
    screen.getByRole("button", { name: "Собрать выпуск (1/132)" }),
  );
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith("/v1/admin/matrix/releases", {
      mode: "partial",
      rule_ids: [id],
    }),
  );
  expect(api.post).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(
    screen.getByRole("button", { name: "Собрать выпуск (1/132)" }),
  ).toBeDisabled();
});
it("publishes only after an explicit choice and sends the observed selection for concurrency control", async () => {
  mount([release]);
  fireEvent.click(
    await screen.findByRole("button", { name: "Выбрать для новых запусков" }),
  );
  await waitFor(() =>
    expect(api.post).toHaveBeenCalledWith(
      `/v1/admin/matrix/releases/${id}/publish`,
      { expected_active_release_id: null },
    ),
  );
});
