import type { MatrixRow, RuleVersion } from "@/api/types/matrix";
import type { MatrixReview, RulePassport } from "@/api/types/matrix-review";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MatrixRuleReview } from "./MatrixRuleReview";

const mocks = vi.hoisted(() => ({
  review: vi.fn(),
  contract: vi.fn(),
  save: vi.fn(),
  run: vi.fn(),
  approve: vi.fn(),
}));
vi.mock("@/api/hooks/use-matrix-review", () => ({
  useMatrixReview: mocks.review,
  useMatrixReviewContract: mocks.contract,
  useSaveMatrixPassport: () => ({ mutate: mocks.save, isPending: false }),
  useRunMatrixRegression: () => ({ mutate: mocks.run, isPending: false }),
}));
vi.mock("@/api/hooks/use-matrix", () => ({
  useApproveMatrixRule: () => ({ mutate: mocks.approve, isPending: false }),
}));
const id = "11111111-1111-4111-8111-111111111111";
const row: MatrixRow = {
  id,
  importId: id,
  parameterId: 1,
  parameterCode: "P001",
  pdSection: "ПЗ",
  name: "Синтетический параметр",
  unit: null,
  sourcePd: null,
  sourceRd: null,
  sourceId: null,
  triggerText: "Синтетический триггер",
  criticality: null,
  matrixRow: 1,
  raw: {},
};
const rule: RuleVersion = {
  id,
  parameterCode: "P001",
  parameterId: 1,
  version: 1,
  status: "draft",
  plan: {},
  note: null,
  createdBy: null,
  createdAt: "2026-09-27T00:00:00Z",
  approvedBy: null,
  approvedAt: null,
};
const passport: RulePassport = {
  id,
  ruleVersionId: id,
  matrixRowId: id,
  revision: 1,
  contentHash: "a".repeat(64),
  createdBy: null,
  createdAt: "2026-09-27T00:00:00Z",
  content: {
    schema_version: 1,
    matrix_row_id: id,
    quantity: "Синтетическая величина",
    applicability: "Синтетическая применимость",
    scope: "Синтетическая область",
    sources: ["PD"],
    unit: null,
    rounding: null,
    branches: [
      {
        id: "extract",
        operator: "extraction",
        version: "test-engine",
        basis_required: false,
        basis: null,
        categories: {
          positive: null,
          negative: null,
          boundary: null,
          uncertain: null,
        },
      },
    ],
    source: {
      import_id: id,
      catalog_sha256: "b".repeat(64),
      origin_sha256: "c".repeat(64),
      row_sha256: "d".repeat(64),
      parameter_code: "P001",
      trigger: row.triggerText,
    },
  },
};
function setReview(overrides: Partial<MatrixReview> = {}) {
  mocks.review.mockReturnValue({
    data: {
      schema_version: 1,
      rule_id: id,
      passports: [passport],
      reports: [],
      legacy_without_review: false,
      ...overrides,
    },
    isPending: false,
    isError: false,
    isFetching: false,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  setReview();
  mocks.contract.mockReturnValue({
    data: {
      schema_version: 1,
      passport: {},
      regression: {},
      engines: { extraction: "test-engine" },
    },
    isPending: false,
  });
});
it("fails closed for absent or rejected server approval instead of enabling from dry-run/history", () => {
  const view = render(<MatrixRuleReview row={row} rule={rule} />);
  expect(
    screen.getByRole("button", { name: "Утвердить проверенную версию" }),
  ).toBeDisabled();
  setReview({
    approval: {
      eligible: false,
      reason: "Исполнители изменились: нужна новая регрессия",
    },
  });
  view.rerender(<MatrixRuleReview row={row} rule={rule} />);
  expect(
    screen.getByRole("button", { name: "Утвердить проверенную версию" }),
  ).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Исполнители изменились",
  );
  expect(mocks.approve).not.toHaveBeenCalled();
});
it("requires an explicit approval click and blocks unsaved passport changes", () => {
  setReview({ approval: { eligible: true, reason: null } });
  render(<MatrixRuleReview row={row} rule={rule} />);
  const button = screen.getByRole("button", {
    name: "Утвердить проверенную версию",
  });
  expect(button).toBeEnabled();
  expect(mocks.approve).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(mocks.approve).toHaveBeenCalledExactlyOnceWith(id);
  fireEvent.change(screen.getByLabelText("Проверяемая величина"), {
    target: { value: "Изменённая величина" },
  });
  expect(button).toBeDisabled();
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Сохранить редакцию паспорта" }),
  );
  expect(mocks.save).toHaveBeenCalledWith({
    ruleId: id,
    passport: expect.objectContaining({
      quantity: "Изменённая величина",
      matrix_row_id: row.id,
    }) as unknown,
  });
  const saved = mocks.save.mock.calls[0]?.[0] as
    { passport: unknown } | undefined;
  expect(saved?.passport).not.toHaveProperty("source");
});
it("uploads and submits original fixture expectations without automatically approving", async () => {
  render(<MatrixRuleReview row={row} rule={rule} />);
  const input = {
    schema_version: 1,
    fixtures: [
      {
        id: "synthetic",
        expected: { value: "unchanged" },
        inputs: [{ artifact: { raw_text: "synthetic input" } }],
      },
    ],
  };
  const file = { text: () => Promise.resolve(JSON.stringify(input)) };
  fireEvent.change(screen.getByLabelText("Загрузить JSON примеров"), {
    target: { files: [file] },
  });
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Запустить регрессию" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Запустить регрессию" }));
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith({
    ruleId: id,
    regression: input,
  });
  expect(mocks.approve).not.toHaveBeenCalled();
});
it("rejects a client-supplied report and keeps historical rules read-only", () => {
  const view = render(<MatrixRuleReview row={row} rule={rule} />);
  fireEvent.change(screen.getByLabelText("Регрессионные примеры (JSON)"), {
    target: {
      value: JSON.stringify({
        schema_version: 1,
        fixtures: [{}],
        report: { passed: true },
      }),
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Запустить регрессию" }));
  expect(mocks.run).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("Нужен JSON");
  view.rerender(
    <MatrixRuleReview row={row} rule={{ ...rule, status: "approved" }} />,
  );
  expect(
    screen.queryByRole("button", {
      name: /Утвердить|Сохранить редакцию|Запустить регрессию/,
    }),
  ).not.toBeInTheDocument();
});
