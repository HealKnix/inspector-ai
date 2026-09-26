import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import {
  confirmExpectedPackage,
  evaluateCompleteness,
  generateExpectedPackage,
  getCompletenessResult,
  getExpectedPackage,
} from "@/api/endpoints/completeness";
import { ApiError } from "@/api/errors";
import type { ExpectedPackageResponse } from "@/api/types/completeness";
import { idRegistry } from "@/pages/identification/lib/identification-test-fixtures";

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

const registry = { ...idRegistry, object_id: objectId };
const emptyResult = {
  schema_version: 1 as const,
  object_id: objectId,
  process_id: registry.process_id,
  run_id: registry.run_id,
  resolved_input_hash: registry.resolved_input_hash,
  package_version: null,
  framework_version: null,
  evaluated_at: null,
  evaluation: null,
  evaluation_absent_reason: "not_evaluated",
};
beforeEach(() => {
  vi.mocked(getCompletenessResult).mockResolvedValue(emptyResult);
});

const proposedPackage: ExpectedPackageResponse = {
  schema_version: 1,
  object_id: objectId,
  package: {
    version: 2,
    status: "proposed",
    framework_version: 1,
    attributes: {},
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
        quantity: { min: 2, per: "object" },
        alternatives: null,
        origin: "framework",
        excluded: false,
        exclusion_reason: null,
        source: { norm_ref: "ТЗ §3 п.1" },
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        code: "RD-KR",
        stage: "RD",
        kind_code: "КР",
        title: "Комплект КР",
        scope: null,
        quantity: { min: 1, per: "object" },
        alternatives: null,
        origin: "framework",
        excluded: true,
        exclusion_reason: "Не применимо",
        source: null,
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        code: "ID-JOURNAL",
        stage: "ID",
        kind_code: "JOURNAL",
        title: "Общий журнал работ",
        scope: null,
        quantity: { min: 1, per: "object" },
        alternatives: null,
        origin: "framework",
        excluded: false,
        exclusion_reason: null,
        source: null,
      },
    ],
    requirements_total: 3,
  },
  package_absent_reason: null,
};

function renderPanel() {
  const client = new QueryClient();
  const rendered = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CompletenessPanel objectId={objectId} registry={registry} canEdit />
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
    vi.mocked(generateExpectedPackage).mockResolvedValue({
      schema_version: 1,
      object_id: objectId,
      package_version: 1,
    });
    const { client, unmount } = renderPanel();
    const button = await screen.findByRole("button", {
      name: "Сформировать состав",
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

  it("показывает предложенный состав и подтверждает его только явным действием", async () => {
    vi.mocked(getExpectedPackage).mockResolvedValue(proposedPackage);
    vi.mocked(confirmExpectedPackage).mockResolvedValue({
      schema_version: 1,
      object_id: objectId,
      package_version: 3,
    });
    vi.mocked(evaluateCompleteness).mockResolvedValue(emptyResult);
    const { client, unmount } = renderPanel();
    fireEvent.click(
      await screen.findByRole("button", { name: "Проверить состав комплекта" }),
    );
    expect(
      screen.getByText("Пояснительная записка — не менее 2"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Комплект КР")).not.toBeInTheDocument();
    expect(confirmExpectedPackage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Подтвердить состав" }));
    await waitFor(() =>
      expect(confirmExpectedPackage).toHaveBeenCalledWith(
        expect.objectContaining({
          objectId,
          expectedVersion: 2,
          basis: "Подтверждаю состав комплекта для этого объекта.",
          attributes: {},
          exclude: [
            {
              requirement_id: "22222222-2222-4222-8222-222222222222",
              reason: "Не применимо",
            },
          ],
        }),
      ),
    );
    expect(
      vi.mocked(confirmExpectedPackage).mock.calls[0]?.[0].requestId,
    ).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() =>
      expect(evaluateCompleteness).toHaveBeenCalledWith({
        objectId,
        runId: registry.run_id,
      }),
    );
    unmount();
    client.clear();
  });

  it("показывает результат по логическим документам, а не количеству файлов", async () => {
    vi.mocked(getExpectedPackage).mockResolvedValue({
      ...proposedPackage,
      package: { ...proposedPackage.package!, status: "confirmed" },
    });
    vi.mocked(getCompletenessResult).mockResolvedValue({
      ...emptyResult,
      package_version: 2,
      evaluation: {
        stages: {
          PD: {
            status: "PARTIAL",
            applicable: 2,
            fulfilled: 1,
            missing: 1,
            unverifiable: 0,
          },
          RD: null,
          ID: {
            status: "UPLOADED",
            applicable: 1,
            fulfilled: 1,
            missing: 0,
            unverifiable: 0,
          },
        },
        scenario: "PD_ID_ONLY",
        requirements: [
          {
            requirement_id: "test",
            code: "PD-PZ",
            title: "Пояснительная записка",
            stage: "PD",
            scope: null,
            outcome: "missing",
            reasons: [],
            matched: [],
            missing_parts: [],
          },
        ],
        counts: {
          applicable: 3,
          fulfilled: 2,
          missing: 1,
          unverifiable: 0,
          not_applicable: 0,
        },
      },
    });
    const { client, unmount } = renderPanel();
    expect(await screen.findByText("Подтверждено 1 из 2")).toBeInTheDocument();
    expect(screen.getByText("Состав не определён")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Что ещё нужно" }));
    expect(
      screen.getByText("Пояснительная записка — загрузите документ"),
    ).toBeInTheDocument();
    unmount();
    client.clear();
  });

  it.each(["snapshot", "run", "package"])(
    "не показывает комплектность другого %s как актуальную",
    async (identity) => {
      vi.mocked(getExpectedPackage).mockResolvedValue({
        ...proposedPackage,
        package: { ...proposedPackage.package!, status: "confirmed" },
      });
      vi.mocked(getCompletenessResult).mockResolvedValue({
        ...emptyResult,
        package_version: identity === "package" ? 1 : 2,
        resolved_input_hash:
          identity === "snapshot"
            ? "f".repeat(64)
            : registry.resolved_input_hash,
        run_id:
          identity === "run"
            ? "99999999-9999-4999-8999-999999999999"
            : registry.run_id,
        evaluation: {
          stages: {
            PD: {
              status: "UPLOADED",
              applicable: 1,
              fulfilled: 1,
              missing: 0,
              unverifiable: 0,
            },
            RD: null,
            ID: null,
          },
          scenario: "SINGLE_ONLY",
          requirements: [],
          counts: {
            applicable: 1,
            fulfilled: 1,
            missing: 0,
            unverifiable: 0,
            not_applicable: 0,
          },
        },
      });
      const { client, unmount } = renderPanel();
      expect(
        await screen.findByText(/Комплектность ещё не определена/),
      ).toBeInTheDocument();
      expect(screen.queryByText(/из 0/)).not.toBeInTheDocument();
      expect(
        screen.queryByText("Документы по подтверждённому составу загружены."),
      ).not.toBeInTheDocument();
      unmount();
      client.clear();
    },
  );

  it("сообщает об ошибке загрузки состава и предлагает повторить", async () => {
    vi.mocked(getExpectedPackage).mockRejectedValue(
      new ApiError("Нет доступа", { status: 403 }),
    );
    const { client, unmount } = renderPanel();
    const retry = await screen.findByRole("button", { name: "Повторить" });
    expect(
      screen.getByText(/Нет доступа к комплектности объекта/),
    ).toBeInTheDocument();
    fireEvent.click(retry);
    unmount();
    client.clear();
  });
});
