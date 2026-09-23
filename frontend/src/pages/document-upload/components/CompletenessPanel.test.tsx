import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import {
  generateExpectedPackage,
  getExpectedPackage,
} from "@/api/endpoints/completeness";
import { ApiError } from "@/api/errors";
import type { ExpectedPackageResponse } from "@/api/types/completeness";
import {
  DocumentStage,
  UploadRowOrigin,
  UploadRowStatus,
  type UploadRow,
} from "@/pages/document-upload/types";

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

function uploadRow(stage: DocumentStage): UploadRow {
  return {
    id: `row-${stage}-${Math.random()}`,
    origin: UploadRowOrigin.REMOTE,
    name: `${stage}.pdf`,
    extension: "pdf",
    sizeBytes: 100,
    clientFileId: null,
    fileId: `file-${stage}-${Math.random()}`,
    sha256: null,
    integrityError: false,
    pageCount: null,
    declaredStage: stage,
    detectedStage: stage,
    stage,
    stageMismatch: false,
    status: UploadRowStatus.READY,
    statusDetail: null,
    needsReview: false,
    retryKind: null,
    existingFileId: null,
    documentKind: null,
  };
}

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

function renderPanel(rows: UploadRow[] = []) {
  const client = new QueryClient();
  const rendered = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CompletenessPanel objectId={objectId} rows={rows} />
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

  it("показывает загружено из ожидаемого по стадиям", async () => {
    vi.mocked(getExpectedPackage).mockResolvedValue(proposedPackage);
    const { client, unmount } = renderPanel([
      uploadRow(DocumentStage.PD),
      uploadRow(DocumentStage.ID),
    ]);
    expect(await screen.findByText("1 из 2")).toBeInTheDocument();
    expect(screen.getByText("0 из 0")).toBeInTheDocument();
    expect(screen.getByText("1 из 1")).toBeInTheDocument();
    expect(
      screen.getByText(/Загружено 2 из 3 документов эталонного состава/),
    ).toBeInTheDocument();
    expect(screen.getByText("Состав предложен")).toBeInTheDocument();
    unmount();
    client.clear();
  });

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
