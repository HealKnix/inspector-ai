import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import {
  confirmExpectedPackage,
  generateExpectedPackage,
  getCompletenessResult,
  getExpectedPackage,
} from "@/api/endpoints/completeness";
import type {
  CompletenessResult,
  ExpectedPackageResponse,
} from "@/api/types/completeness";
import { CompletenessPanel } from "./CompletenessPanel";

vi.mock("@/api/endpoints/completeness", () => ({
  getExpectedPackage: vi.fn(),
  generateExpectedPackage: vi.fn(),
  confirmExpectedPackage: vi.fn(),
  evaluateCompleteness: vi.fn(),
  getCompletenessResult: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());

const objectId = "88888888-8888-4888-8888-888888888888";

const proposedPackage: ExpectedPackageResponse = {
  schema_version: 1,
  object_id: objectId,
  package: {
    version: 2,
    status: "proposed",
    framework_version: 1,
    attributes: { demolition: true },
    confirmed_by: null,
    confirmed_at: null,
    basis: null,
    list_items: [],
    requirements: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        code: "PD-PZ",
        stage: "PD",
        kind_code: "ПЗ",
        title: "Пояснительная записка",
        scope: null,
        quantity: { min: 1, per: "object" },
        alternatives: null,
        origin: "framework",
        excluded: false,
        exclusion_reason: null,
        source: { norm_ref: "ТЗ §3 п.1" },
      },
    ],
    requirements_total: 1,
  },
  package_absent_reason: null,
};

const emptyResult: CompletenessResult = {
  schema_version: 1,
  object_id: objectId,
  process_id: null,
  run_id: null,
  package_version: null,
  framework_version: null,
  evaluated_at: null,
  evaluation: null,
  evaluation_absent_reason: "not_evaluated",
};

function renderPanel() {
  const client = new QueryClient();
  const rendered = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CompletenessPanel objectId={objectId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, ...rendered };
}

describe("completeness panel", () => {
  it("предлагает сформировать состав при его отсутствии", async () => {
    vi.mocked(getExpectedPackage).mockResolvedValue({
      schema_version: 1,
      object_id: objectId,
      package: null,
      package_absent_reason: "package_not_generated",
    });
    vi.mocked(getCompletenessResult).mockResolvedValue(emptyResult);
    vi.mocked(generateExpectedPackage).mockResolvedValue({
      schema_version: 1,
      object_id: objectId,
      package_version: 1,
    });
    const { client, unmount } = renderPanel();
    const button = await screen.findByRole("button", {
      name: "Сформировать предложение",
    });
    fireEvent.click(button);
    await waitFor(() =>
      expect(generateExpectedPackage).toHaveBeenCalledWith(
        expect.objectContaining({ objectId }),
      ),
    );
    unmount();
    client.clear();
  });

  it("не подтверждает предложение без основания", async () => {
    vi.mocked(getExpectedPackage).mockResolvedValue(proposedPackage);
    vi.mocked(getCompletenessResult).mockResolvedValue(emptyResult);
    const { client, unmount } = renderPanel();
    const button = await screen.findByRole("button", {
      name: "Подтвердить состав v2",
    });
    expect(button).toBeDisabled();
    unmount();
    client.clear();
  });

  it("подтверждает состав с версией, основанием и ключом идемпотентности", async () => {
    vi.mocked(getExpectedPackage).mockResolvedValue(proposedPackage);
    vi.mocked(getCompletenessResult).mockResolvedValue(emptyResult);
    vi.mocked(confirmExpectedPackage).mockResolvedValue({
      schema_version: 1,
      object_id: objectId,
      package_version: 3,
    });
    const { client, unmount } = renderPanel();
    const basis = await screen.findByLabelText("Основание подтверждения");
    fireEvent.change(basis, { target: { value: "Сверено с ПЗ" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Подтвердить состав v2" }),
    );
    await waitFor(() =>
      expect(confirmExpectedPackage).toHaveBeenCalledWith(
        expect.objectContaining({
          objectId,
          expectedVersion: 2,
          basis: "Сверено с ПЗ",
          requestId: expect.any(String) as string,
        }),
      ),
    );
    unmount();
    client.clear();
  });

  it("показывает серверные агрегаты и причины незакрытых требований", async () => {
    vi.mocked(getExpectedPackage).mockResolvedValue(proposedPackage);
    vi.mocked(getCompletenessResult).mockResolvedValue({
      ...emptyResult,
      run_id: "44444444-4444-4444-8444-444444444444",
      package_version: 2,
      evaluated_at: "2026-09-20T15:00:00.000Z",
      evaluation_absent_reason: null,
      evaluation: {
        stages: {
          PD: {
            status: "MISSING",
            applicable: 1,
            fulfilled: 0,
            missing: 1,
            unverifiable: 0,
          },
          RD: null,
          ID: null,
        },
        scenario: "PARTIALLY_LOADED",
        requirements: [
          {
            requirement_id: "11111111-1111-4111-8111-111111111111",
            code: "PD-PZ",
            title: "Пояснительная записка",
            stage: "PD",
            scope: null,
            outcome: "missing",
            reasons: ["required_document_missing"],
            matched: [],
            missing_parts: ["нет документа вида ПЗ"],
          },
        ],
        counts: {
          applicable: 1,
          fulfilled: 0,
          missing: 1,
          unverifiable: 0,
          not_applicable: 0,
        },
      },
    });
    const { client, unmount } = renderPanel();
    await screen.findByText("Результат комплектности");
    expect(screen.getByText("Комплект загружен частично")).toBeInTheDocument();
    expect(screen.getByText("Отсутствует")).toBeInTheDocument();
    expect(
      screen.getByText(/обязательный документ отсутствует/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Применимо 1/)).toBeInTheDocument();
    unmount();
    client.clear();
  });
});
