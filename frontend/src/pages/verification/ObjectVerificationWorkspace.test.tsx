import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { getObject, listObjects } from "@/api/endpoints/objects";
import {
  getParseResult,
  getParsingStatus,
  getRenderedPage,
} from "@/api/endpoints/parsing";
import {
  getFinding,
  getProtocol,
  listFindings,
  postDecision,
} from "@/api/endpoints/verification";
import { queryKeys } from "@/api/query-keys";
import type { ConstructionObject } from "@/api/types/objects";
import {
  parsedFile,
  parseResult,
  parsingObjectId,
} from "@/api/types/parsing-test-fixtures";
import type { ApiFinding } from "@/api/types/verification";
import routeNames from "@/routes/routeNames";

import { VerificationPage } from "./VerificationPage";

vi.mock("@/api/endpoints/objects", () => ({
  createObject: vi.fn(),
  getObject: vi.fn(),
  getReceipt: vi.fn(),
  listFiles: vi.fn(),
  listObjects: vi.fn(),
  uploadDocuments: vi.fn(),
}));

vi.mock("@/api/endpoints/parsing", () => ({
  getParseResult: vi.fn(),
  getParsingStatus: vi.fn(),
  getRenderedPage: vi.fn(),
  retryParsing: vi.fn(),
}));

vi.mock("@/api/endpoints/verification", () => ({
  finalizeProtocol: vi.fn(),
  generateProtocol: vi.fn(),
  getFinding: vi.fn(),
  getProtocol: vi.fn(),
  listFindings: vi.fn(),
  postDecision: vi.fn(),
}));

const object: ConstructionObject = {
  id: parsingObjectId,
  name: "Синтетический объект для предпросмотра",
  created_by: "synthetic",
  created_at: "2026-09-20T00:00:00.000Z",
  updated_at: "2026-09-20T00:00:00.000Z",
  allowed_actions: [],
};
const revokeObjectUrl = vi.fn();

function renderPage(
  initialEntry = routeNames.DOCUMENT_VERIFICATION_DETAILS(parsingObjectId),
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <VerificationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { ...view, client };
}

beforeEach(() => {
  vi.resetAllMocks();
  URL.createObjectURL = vi.fn(() => "blob:synthetic-verification-page");
  URL.revokeObjectURL = revokeObjectUrl;
  vi.mocked(getObject).mockResolvedValue(object);
  vi.mocked(getRenderedPage).mockResolvedValue(
    new Blob(["synthetic"], { type: "image/png" }),
  );
  vi.mocked(getProtocol).mockResolvedValue({
    schema_version: 1,
    object_id: parsingObjectId,
    process_status: "READY",
    protocol: null,
    versions: [],
    protocol_absent_reason: "protocol_not_generated",
  });
});

describe("object verification workspace", () => {
  function integrityFixture(role: "expected" | "actual" = "expected") {
    const item: ApiFinding = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      parameter_code: "P001",
      parameter_name: "Синтетическая проверка",
      scope_key: "context:1",
      status: "CANDIDATE",
      risk: null,
      reason_code: null,
      comment: null,
      decided_at: null,
      has_evidence: true,
      evidence_preview: null,
      finding_version: 1,
      gate_reasons: [],
      verdict: null,
    };
    const protocolId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    vi.mocked(getProtocol).mockResolvedValue({
      schema_version: 1,
      object_id: parsingObjectId,
      process_status: "READY",
      protocol: {
        id: protocolId,
        version: 1,
        status: "active",
        scenario: "FULL",
        created_at: "2026-09-20T00:00:00Z",
        finalized_at: null,
        findings: 1,
        run_id: parsedFile.run_id,
        parameters: 1,
        parameters_compared: 1,
      },
      versions: [],
      protocol_absent_reason: null,
    });
    vi.mocked(listFindings).mockResolvedValue({
      schema_version: 1,
      object_id: parsingObjectId,
      protocol_id: protocolId,
      items: [item],
      findings_absent_reason: null,
    });
    vi.mocked(getFinding).mockResolvedValue({
      schema_version: 1,
      object_id: parsingObjectId,
      finding: {
        ...item,
        protocol_version: 1,
        run_id: parsedFile.run_id,
        decisions: [],
        context: {
          context_id: "context:1",
          scope: "Оси 14–17",
          works_period: { from: "2026-04-20", to: "2026-04-20" },
          reference: {
            document_id: "reference",
            revision_id: "revision-reference",
          },
          actual: { document_id: "act", revision_id: "revision-act" },
          status: "READY",
          blockers: [],
        },
        members: [
          {
            extraction_id: "88888888-8888-4888-8888-888888888888",
            file_id: parsedFile.file_id,
            artifact_id: parsedFile.artifact_id!,
            stage: role === "expected" ? "RD" : "ID",
            role,
            status: "extracted",
            value: 2,
            value_raw: "2",
            unit: null,
            evidence: [
              {
                extractionId: "88888888-8888-4888-8888-888888888888",
                fileId: parsedFile.file_id,
                artifactId: parsedFile.artifact_id!,
                pageNumber: 2,
                blockId: null,
                sheetLabel: null,
                quote: "Доказательство со второй страницы",
                bbox: [0.1, 0.2, 0.3, 0.4],
              },
            ],
          },
        ],
      },
    });
    vi.mocked(getParsingStatus).mockResolvedValue({
      schema_version: 1,
      active: false,
      poll_after_ms: 2000,
      items: [parsedFile],
    });
    const parsed = structuredClone(parseResult);
    parsed.artifact.pages.push({
      ...structuredClone(parsed.artifact.pages[0]!),
      page_number: 2,
    });
    vi.mocked(getParseResult).mockResolvedValue(parsed);
    return { item, protocolId };
  }

  it("opens the real object index by default without demo data", async () => {
    vi.mocked(listObjects).mockResolvedValue({
      items: [object],
      total: 1,
      page: 1,
      limit: 20,
      allowed_actions: [],
    });
    const view = renderPage("/verification");
    expect(
      await screen.findByRole("link", { name: object.name }),
    ).toHaveAttribute(
      "href",
      routeNames.DOCUMENT_VERIFICATION_DETAILS(object.id),
    );
    expect(screen.queryByText("ДЕМО")).not.toBeInTheDocument();
    expect(getProtocol).not.toHaveBeenCalled();
    view.unmount();
    view.client.clear();
  });

  it("pins current findings and opens a deep link on its exact evidence page", async () => {
    const { item, protocolId } = integrityFixture();
    const view = renderPage(
      `${routeNames.DOCUMENT_VERIFICATION_DETAILS(parsingObjectId)}&finding=${item.id}`,
    );
    await waitFor(() => expect(getParseResult).toHaveBeenCalled());
    await waitFor(() =>
      expect(getRenderedPage).toHaveBeenCalledWith(
        parsingObjectId,
        parsedFile.file_id,
        parsedFile.artifact_id,
        2,
        expect.any(AbortSignal),
        parsedFile.run_id,
      ),
    );
    expect(
      await screen.findByRole(
        "img",
        {
          name: "Страница 2 документа synthetic.xml",
        },
        { timeout: 5000 },
      ),
    ).toBeVisible();
    expect(listFindings).toHaveBeenCalledWith(
      parsingObjectId,
      { protocol_id: protocolId },
      expect.any(AbortSignal),
    );
    expect(
      screen.getByRole("img", {
        name: "Доказательство: Доказательство со второй страницы",
      }),
    ).toHaveStyle({ left: "10%", top: "20%" });
    expect(
      screen.getAllByText("Оси 14–17 · 2026-04-20 — 2026-04-20").length,
    ).toBeGreaterThan(0);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Предыдущая страница, Эталонный документ (РД)",
      }),
    );
    expect(
      await screen.findByRole(
        "img",
        {
          name: "Страница 1 документа synthetic.xml",
        },
        { timeout: 5000 },
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("img", {
        name: "Доказательство: Доказательство со второй страницы",
      }),
    ).not.toBeInTheDocument();
    view.unmount();
    view.client.clear();
  });

  it("does not load a finding from another protocol in a forged deep link", async () => {
    const { protocolId } = integrityFixture();
    const view = renderPage(
      `${routeNames.DOCUMENT_VERIFICATION_DETAILS(parsingObjectId)}&protocolId=${protocolId}&finding=cccccccc-cccc-4ccc-8ccc-cccccccccccc`,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "не принадлежит выбранному протоколу",
    );
    expect(getFinding).not.toHaveBeenCalled();
    expect(getParseResult).not.toHaveBeenCalled();
    expect(getRenderedPage).not.toHaveBeenCalled();
    view.unmount();
    view.client.clear();
  });

  it("keeps the missing reference slot empty for a singleton actual source", async () => {
    const { item } = integrityFixture("actual");
    const view = renderPage(
      `${routeNames.DOCUMENT_VERIFICATION_DETAILS(parsingObjectId)}&finding=${item.id}&leftFile=${parsedFile.file_id}`,
    );
    expect(
      await screen.findByRole(
        "img",
        { name: "Страница 2 документа synthetic.xml" },
        { timeout: 5000 },
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: "Документ для сравнения не определён",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Уточнить документы" }),
    ).toHaveAttribute(
      "href",
      routeNames.OBJECT_DOCUMENTS(parsingObjectId, {
        processId: parsedFile.process_id,
        runId: parsedFile.run_id,
      }),
    );
    expect(screen.getAllByRole("img", { name: /^Страница/ })).toHaveLength(1);
    expect(
      screen.queryByText("Эталонный документ (ИД)"),
    ).not.toBeInTheDocument();
    view.unmount();
    view.client.clear();
  });

  it("does not substitute current-run originals for a result without evidence", async () => {
    const { item, protocolId } = integrityFixture();
    const second = {
      ...parsedFile,
      file_id: "77777777-7777-4777-8777-777777777777",
      artifact_id: "99999999-9999-4999-8999-999999999999",
      original_name: "second-synthetic.xml",
    };
    vi.mocked(getFinding).mockResolvedValue({
      schema_version: 1,
      object_id: parsingObjectId,
      finding: {
        ...item,
        protocol_version: 1,
        run_id: parsedFile.run_id,
        members: [],
        decisions: [],
      },
    });
    vi.mocked(listFindings).mockResolvedValue({
      schema_version: 1,
      object_id: parsingObjectId,
      protocol_id: protocolId,
      items: [{ ...item, has_evidence: false }],
      findings_absent_reason: null,
    });
    vi.mocked(getParsingStatus).mockResolvedValue({
      schema_version: 1,
      active: false,
      poll_after_ms: 2000,
      items: [
        parsedFile,
        second,
        {
          ...parsedFile,
          file_id: "66666666-6666-4666-8666-666666666666",
          run_id: "88888888-8888-4888-8888-888888888888",
          original_name: "other-run.xml",
        },
      ],
    });
    vi.mocked(getParseResult).mockImplementation(
      (_objectId, fileId, runId, artifactId) =>
        Promise.resolve({
          ...structuredClone(parseResult),
          file_id: fileId,
          run_id: runId,
          artifact_id: artifactId,
        }),
    );
    const view = renderPage(
      `${routeNames.DOCUMENT_VERIFICATION_DETAILS(parsingObjectId)}&rightFile=${parsedFile.file_id}`,
    );
    expect(
      await screen.findByText("Находок для проверки пока нет."),
    ).toBeVisible();
    await waitFor(() =>
      expect(
        screen.queryByText("Загружаем находки протокола…"),
      ).not.toBeInTheDocument(),
    );
    expect(getFinding).not.toHaveBeenCalled();
    expect(getParseResult).not.toHaveBeenCalled();
    expect(getRenderedPage).not.toHaveBeenCalled();
    expect(screen.queryByText("other-run.xml")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: /^Доказательство:/ }),
    ).not.toBeInTheDocument();
    view.unmount();
    view.client.clear();
  });

  it("does not replace a missing pinned page with the first page", async () => {
    const { item } = integrityFixture();
    const view = renderPage(
      `${routeNames.DOCUMENT_VERIFICATION_DETAILS(parsingObjectId)}&finding=${item.id}&leftPage=9`,
    );
    expect(
      await screen.findByText(
        "Запрошенная страница отсутствует в зафиксированном результате обработки.",
        {},
        { timeout: 5000 },
      ),
    ).toBeVisible();
    expect(getRenderedPage).not.toHaveBeenCalled();
    view.unmount();
    view.client.clear();
  });

  it("omits all empty parameter results without claiming a completed inspection", async () => {
    const { item, protocolId } = integrityFixture();
    vi.mocked(getParsingStatus).mockResolvedValue({
      schema_version: 1,
      active: false,
      poll_after_ms: 2000,
      items: [],
    });
    const items = Array.from({ length: 132 }, (_, index): ApiFinding => ({
      ...item,
      id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index + 1).padStart(12, "0")}`,
      parameter_code: `P${String(index + 1).padStart(3, "0")}`,
      status: index === 0 ? "CANDIDATE" : "MISSING_EVIDENCE",
      has_evidence: false,
      gate_reasons: index === 0 ? [] : ["rule_not_approved"],
    }));
    vi.mocked(listFindings).mockResolvedValue({
      schema_version: 1,
      object_id: parsingObjectId,
      protocol_id: protocolId,
      items,
      findings_absent_reason: null,
    });
    vi.mocked(getFinding).mockResolvedValue({
      schema_version: 1,
      object_id: parsingObjectId,
      finding: {
        ...items[0]!,
        protocol_version: 1,
        run_id: parsedFile.run_id,
        members: [],
        decisions: [],
      },
    });
    const view = renderPage(
      `${routeNames.DOCUMENT_VERIFICATION_DETAILS(parsingObjectId)}&finding=${items[0]!.id}`,
    );
    expect(
      await screen.findByText("Находок для проверки пока нет."),
    ).toBeVisible();
    await waitFor(() =>
      expect(
        screen.queryByText("Загружаем находки протокола…"),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText("Это не означает, что все параметры проверены."),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Открыть расхождение/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Нет доказательств 131")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Финализировать протокол" }),
    ).toBeDisabled();
    expect(getFinding).not.toHaveBeenCalled();
    expect(getParseResult).not.toHaveBeenCalled();
    expect(getRenderedPage).not.toHaveBeenCalled();
    view.unmount();
    view.client.clear();
  });

  it("counts and navigates only evidenced questions, replacing a stale link to an empty result", async () => {
    const { item, protocolId } = integrityFixture();
    const protocolResponse = await vi
      .mocked(getProtocol)
      .getMockImplementation()!(parsingObjectId);
    vi.mocked(getProtocol).mockResolvedValue({
      ...protocolResponse,
      protocol: {
        ...protocolResponse.protocol!,
        findings: 168,
        parameters: 132,
        parameters_compared: 0,
      },
    });
    const placeholders = Array.from(
      { length: 165 },
      (_, index): ApiFinding => ({
        ...item,
        id: `dddddddd-dddd-4ddd-8ddd-${String(index + 1).padStart(12, "0")}`,
        parameter_code: "P040",
        parameter_name: "Пустой параметр",
        status: "MISSING_EVIDENCE",
        has_evidence: false,
        gate_reasons: ["rule_not_approved"],
      }),
    );
    const questions = ["P009", "P009", "P019"].map(
      (code, index): ApiFinding => ({
        ...item,
        id: `eeeeeeee-eeee-4eee-8eee-${String(index + 1).padStart(12, "0")}`,
        parameter_code: code,
        parameter_name: `Найденные сведения ${index + 1}`,
        scope_key: `context:${index + 1}`,
        status: "CLARIFICATION_REQUIRED",
        evidence_preview: {
          file_id: parsedFile.file_id,
          role: "actual",
          value: index === 2 ? null : 163.46,
          value_raw: index === 2 ? null : "163,46",
          unit: null,
          quote: `Цитата из документа ${index + 1}`,
        },
      }),
    );
    vi.mocked(listFindings).mockResolvedValue({
      schema_version: 1,
      object_id: parsingObjectId,
      protocol_id: protocolId,
      items: [...placeholders, ...questions],
      findings_absent_reason: null,
    });
    const fixtureDetail = vi.mocked(getFinding).getMockImplementation()!;
    vi.mocked(getFinding).mockImplementation(async (...args) => {
      const response = await fixtureDetail(...args);
      const selected = questions.find((question) => question.id === args[1])!;
      return { ...response, finding: { ...response.finding, ...selected } };
    });
    const view = renderPage(
      `${routeNames.DOCUMENT_VERIFICATION_DETAILS(parsingObjectId)}&finding=${placeholders[0]!.id}&leftFile=${parsedFile.file_id}&leftPage=9`,
    );

    const heading = await screen.findByRole("heading", {
      name: "Находки для проверки",
    });
    const queue = within(heading.closest("section")!);
    expect(
      await queue.findAllByRole("button", { name: /Открыть расхождение/ }),
    ).toHaveLength(3);
    expect(
      queue.getByText(
        (_text, element) =>
          element?.tagName === "P" &&
          element.textContent === "Параметров: 2Находок: 3",
      ),
    ).toBeVisible();
    expect(queue.getByRole("radio", { name: "Все 3" })).toBeVisible();
    expect(
      screen.getByText("Находок: 3 · Параметров проверено: 0 из 132"),
    ).toBeVisible();
    expect(
      queue.queryByRole("radio", { name: /Нет доказательств/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/P040/)).not.toBeInTheDocument();
    expect(
      await screen.findByRole("img", {
        name: "Страница 2 документа synthetic.xml",
      }),
    ).toBeVisible();
    expect(
      screen.queryByText(/не принадлежит выбранному протоколу/),
    ).not.toBeInTheDocument();
    expect(getFinding).toHaveBeenCalledWith(
      parsingObjectId,
      questions[0]!.id,
      expect.any(AbortSignal),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Следующее расхождение" }),
    );
    await waitFor(() =>
      expect(getFinding).toHaveBeenCalledWith(
        parsingObjectId,
        questions[1]!.id,
        expect.any(AbortSignal),
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Следующее расхождение" }),
    );
    await waitFor(() =>
      expect(getFinding).toHaveBeenCalledWith(
        parsingObjectId,
        questions[2]!.id,
        expect.any(AbortSignal),
      ),
    );
    expect(
      vi
        .mocked(getFinding)
        .mock.calls.every((call) =>
          questions.some((question) => question.id === call[1]),
        ),
    ).toBe(true);

    fireEvent.change(queue.getByRole("searchbox"), {
      target: { value: "P040" },
    });
    expect(
      queue.queryByRole("button", { name: /Открыть расхождение/ }),
    ).not.toBeInTheDocument();
    view.unmount();
    view.client.clear();
  });

  it("opens a historical finding against its frozen artifact and run", async () => {
    const oldRun = parsedFile.run_id;
    const newRun = "77777777-7777-4777-8777-777777777777";
    const oldArtifact = parsedFile.artifact_id!;
    const item: ApiFinding = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      parameter_code: "P022",
      parameter_name: "Исторический параметр",
      scope_key: "",
      status: "NEGATIVE_VERIFIED",
      risk: null,
      reason_code: null,
      comment: null,
      decided_at: "2026-09-20T12:00:00Z",
      has_evidence: true,
      evidence_preview: null,
      finding_version: 1,
      gate_reasons: [],
      verdict: null,
    };
    vi.mocked(getProtocol).mockResolvedValue({
      schema_version: 1,
      object_id: parsingObjectId,
      process_status: "PENDING",
      current_run_id: newRun,
      is_current: false,
      protocol: {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        version: 1,
        status: "superseded",
        scenario: "FULL",
        created_at: "2026-09-20T00:00:00Z",
        finalized_at: null,
        findings: 1,
        run_id: oldRun,
        resolved_input_hash: "d".repeat(64),
        is_current: false,
      },
      versions: [],
      protocol_absent_reason: null,
    });
    vi.mocked(listFindings).mockResolvedValue({
      schema_version: 1,
      object_id: parsingObjectId,
      protocol_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      items: [item],
      findings_absent_reason: null,
    });
    vi.mocked(getFinding).mockResolvedValue({
      schema_version: 1,
      object_id: parsingObjectId,
      finding: {
        ...item,
        protocol_version: 1,
        run_id: oldRun,
        evidence_absent_reason: null,
        members: [
          {
            extraction_id: "88888888-8888-4888-8888-888888888888",
            file_id: parsedFile.file_id,
            artifact_id: oldArtifact,
            stage: "PD",
            role: "expected",
            status: "extracted",
            value: "II",
            value_raw: "II",
            unit: null,
            evidence: [
              {
                extractionId: "88888888-8888-4888-8888-888888888888",
                fileId: parsedFile.file_id,
                artifactId: oldArtifact,
                pageNumber: 1,
                blockId: "block-1",
                sheetLabel: null,
                quote: "Сохранённое доказательство",
                bbox: [0.1, 0.2, 0.4, 0.25],
              },
            ],
          },
        ],
        decisions: [],
      },
    });
    vi.mocked(getParsingStatus).mockResolvedValue({
      schema_version: 1,
      active: false,
      poll_after_ms: 2000,
      items: [
        {
          ...parsedFile,
          run_id: newRun,
          artifact_id: "99999999-9999-4999-8999-999999999999",
        },
      ],
    });
    vi.mocked(getParseResult).mockResolvedValue(structuredClone(parseResult));
    renderPage();
    await waitFor(() =>
      expect(getParseResult).toHaveBeenCalledWith(
        parsingObjectId,
        parsedFile.file_id,
        oldRun,
        oldArtifact,
        expect.any(AbortSignal),
      ),
    );
    expect(
      vi
        .mocked(getParseResult)
        .mock.calls.every(
          (call) => call[2] === oldRun && call[3] === oldArtifact,
        ),
    ).toBe(true);
    expect(
      screen.queryByRole("button", { name: "Финализировать протокол" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Открыть документы и редакции" }),
    ).toHaveAttribute(
      "href",
      routeNames.OBJECT_DOCUMENTS(parsingObjectId, {
        processId: parsedFile.process_id,
        runId: oldRun,
        resolvedInputHash: "d".repeat(64),
      }),
    );
  });
  it("открывает реальные страницы комплекта через защищённый предпросмотр", async () => {
    const file = {
      ...parsedFile,
      pages_completed: 2,
      pages_total: 2,
    };
    const result = structuredClone(parseResult);
    const secondPage = structuredClone(result.artifact.pages[0]!);
    secondPage.page_number = 2;
    secondPage.image_key = "88888888-8888-4888-8888-888888888888";
    secondPage.blocks = secondPage.blocks.map((block) => ({
      ...block,
      id: `${block.id}-page-2`,
    }));
    result.artifact.pages.push(secondPage);
    result.artifact.coverage = {
      total_pages: 2,
      readable_pages: 2,
      unreadable_pages: 0,
    };

    vi.mocked(getParsingStatus).mockResolvedValue({
      schema_version: 1,
      active: false,
      poll_after_ms: 2000,
      items: [file],
    });
    vi.mocked(getParseResult).mockResolvedValue(result);

    const view = renderPage();

    expect(
      await screen.findByRole("heading", {
        name: "Проверка комплекта документов",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(object.name)).toBeVisible();
    expect(screen.queryByText("ДЕМО")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Список расхождений" }),
    ).not.toBeInTheDocument();

    expect(
      await screen.findByRole(
        "img",
        {
          name: "Страница 1 документа synthetic.xml",
        },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    expect(getObject).toHaveBeenCalledWith(
      parsingObjectId,
      expect.any(AbortSignal),
    );
    expect(getParseResult).toHaveBeenCalledWith(
      parsingObjectId,
      file.file_id,
      file.run_id,
      file.artifact_id,
      expect.any(AbortSignal),
    );
    expect(getRenderedPage).toHaveBeenCalledWith(
      parsingObjectId,
      file.file_id,
      file.artifact_id,
      1,
      expect.any(AbortSignal),
      file.run_id,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Следующая страница, Исходный документ 1",
      }),
    );

    expect(
      await screen.findByRole(
        "img",
        {
          name: "Страница 2 документа synthetic.xml",
        },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(getRenderedPage).toHaveBeenCalledWith(
        parsingObjectId,
        file.file_id,
        file.artifact_id,
        2,
        expect.any(AbortSignal),
        file.run_id,
      ),
    );

    view.unmount();
    expect(revokeObjectUrl).toHaveBeenCalled();
    view.client.clear();
  });

  it("показывает находки протокола и отправляет решение через API", async () => {
    const findingId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const item = {
      id: findingId,
      parameter_code: "P022",
      parameter_name: "Класс стойкости",
      scope_key: "object",
      status: "CANDIDATE" as const,
      risk: "критичный",
      reason_code: null,
      comment: null,
      decided_at: null,
      has_evidence: true,
      evidence_preview: null,
      finding_version: 2,
      gate_reasons: null,
      verdict: {
        engine: "comparison-v1",
        status: "discrepancy" as const,
        spec: { kind: "equals" },
        expected: [
          {
            extraction_id: "88888888-8888-4888-8888-888888888888",
            file_id: parsedFile.file_id,
            value: "II",
            value_raw: "II",
            unit: null,
          },
        ],
        actual: [],
        pairs: [],
        warnings: [],
        evaluated_at: "2026-10-01T00:00:00.000Z",
      },
    };

    vi.mocked(getProtocol).mockResolvedValue({
      schema_version: 1,
      object_id: parsingObjectId,
      process_status: "VERIFYING",
      protocol: {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        version: 1,
        status: "active",
        scenario: "initial",
        created_at: "2026-10-01T00:00:00.000Z",
        finalized_at: null,
        findings: 1,
      },
      versions: [],
      protocol_absent_reason: null,
    });
    vi.mocked(listFindings).mockResolvedValue({
      schema_version: 1,
      object_id: parsingObjectId,
      protocol_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      items: [item],
      findings_absent_reason: null,
    });
    vi.mocked(getFinding).mockResolvedValue({
      schema_version: 1,
      object_id: parsingObjectId,
      finding: {
        ...item,
        protocol_version: 1,
        run_id: parsedFile.run_id,
        members: [
          {
            extraction_id: "88888888-8888-4888-8888-888888888888",
            file_id: parsedFile.file_id,
            artifact_id: parsedFile.artifact_id!,
            stage: "PD",
            role: "expected" as const,
            status: "extracted",
            value: "II",
            value_raw: "II",
            unit: null,
            evidence: [
              {
                extractionId: "88888888-8888-4888-8888-888888888888",
                fileId: parsedFile.file_id,
                pageNumber: 1,
                sheetLabel: null,
                blockId: "block-1",
                quote: "Класс стойкости II",
                bbox: [0.1, 0.2, 0.4, 0.25],
              },
            ],
          },
        ],
        decisions: [],
      },
    });
    vi.mocked(getParsingStatus).mockResolvedValue({
      schema_version: 1,
      active: false,
      poll_after_ms: 2000,
      items: [parsedFile],
    });
    vi.mocked(getParseResult).mockResolvedValue(structuredClone(parseResult));
    vi.mocked(postDecision).mockResolvedValue({
      schema_version: 1,
      object_id: parsingObjectId,
      finding: { ...item, status: "CONFIRMED_VIOLATION" as const },
      process_status: "COMPLETED",
      replayed: false,
    });

    const view = renderPage();

    expect(
      await screen.findByRole("heading", { name: "Находки для проверки" }),
    ).toBeInTheDocument();
    const card = await screen.findByRole("button", {
      name: /P022 · Класс стойкости/,
    });
    fireEvent.click(card);

    expect(
      await screen.findByRole("button", { name: "Подтвердить нарушение" }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Подтвердить нарушение" }),
    );
    fireEvent.change(screen.getByLabelText("Комментарий инспектора"), {
      target: { value: "Расхождение подтверждено по оригиналу." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить решение" }));

    await waitFor(() => expect(postDecision).toHaveBeenCalledTimes(1));
    const [, calledFindingId, body] = vi.mocked(postDecision).mock.calls[0]!;
    expect(calledFindingId).toBe(findingId);
    expect(body).toMatchObject({
      action: "confirm",
      finding_version: 2,
      comment: "Расхождение подтверждено по оригиналу.",
    });
    expect(body.request_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    view.unmount();
    view.client.clear();
  });

  it("открывает страницу доказательства при выборе находки", async () => {
    const file = {
      ...parsedFile,
      pages_completed: 2,
      pages_total: 2,
    };
    const result = structuredClone(parseResult);
    const secondPage = structuredClone(result.artifact.pages[0]!);
    secondPage.page_number = 2;
    secondPage.image_key = "88888888-8888-4888-8888-888888888888";
    secondPage.blocks = secondPage.blocks.map((block) => ({
      ...block,
      id: `${block.id}-page-2`,
    }));
    result.artifact.pages.push(secondPage);
    result.artifact.coverage = {
      total_pages: 2,
      readable_pages: 2,
      unreadable_pages: 0,
    };

    const makeItem = (
      id: string,
      code: string,
      name: string,
      risk: string,
    ) => ({
      id,
      parameter_code: code,
      parameter_name: name,
      scope_key: "object",
      status: "CANDIDATE" as const,
      risk,
      reason_code: null,
      comment: null,
      decided_at: null,
      has_evidence: true,
      evidence_preview: null,
      finding_version: 1,
      gate_reasons: null,
      verdict: {
        engine: "comparison-v1",
        status: "discrepancy" as const,
        spec: { kind: "equals" },
        expected: [
          {
            extraction_id: "88888888-8888-4888-8888-888888888888",
            file_id: file.file_id,
            value: "II",
            value_raw: "II",
            unit: null,
          },
        ],
        actual: [],
        pairs: [],
        warnings: [],
        evaluated_at: "2026-10-01T00:00:00.000Z",
      },
    });
    const first = makeItem(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "P001",
      "Первый параметр",
      "критичный",
    );
    const second = makeItem(
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      "P002",
      "Второй параметр",
      "низкий",
    );
    const makeDetail = (
      item: ReturnType<typeof makeItem>,
      pageNumber: number,
      blockId: string,
    ) => ({
      schema_version: 1 as const,
      object_id: parsingObjectId,
      finding: {
        ...item,
        protocol_version: 1,
        run_id: parsedFile.run_id,
        members: [
          {
            extraction_id: "88888888-8888-4888-8888-888888888888",
            file_id: file.file_id,
            artifact_id: file.artifact_id!,
            stage: "PD",
            role: "expected" as const,
            status: "extracted",
            value: "II",
            value_raw: "II",
            unit: null,
            evidence: [
              {
                extractionId: "88888888-8888-4888-8888-888888888888",
                fileId: file.file_id,
                pageNumber,
                sheetLabel: null,
                blockId,
                quote: "Значение II",
                bbox: [0.1, 0.2, 0.4, 0.25],
              },
            ],
          },
        ],
        decisions: [],
      },
    });

    vi.mocked(getProtocol).mockResolvedValue({
      schema_version: 1,
      object_id: parsingObjectId,
      process_status: "VERIFYING",
      protocol: {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        version: 1,
        status: "active",
        scenario: "initial",
        created_at: "2026-10-01T00:00:00.000Z",
        finalized_at: null,
        findings: 2,
      },
      versions: [],
      protocol_absent_reason: null,
    });
    vi.mocked(listFindings).mockResolvedValue({
      schema_version: 1,
      object_id: parsingObjectId,
      protocol_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      items: [first, second],
      findings_absent_reason: null,
    });
    vi.mocked(getFinding).mockImplementation((_objectId, findingId) =>
      Promise.resolve(
        findingId === second.id
          ? makeDetail(second, 2, "block-1-page-2")
          : makeDetail(first, 1, "block-1"),
      ),
    );
    vi.mocked(getParsingStatus).mockResolvedValue({
      schema_version: 1,
      active: false,
      poll_after_ms: 2000,
      items: [file],
    });
    vi.mocked(getParseResult).mockResolvedValue(result);

    const view = renderPage();

    expect(
      await screen.findByRole(
        "img",
        {
          name: "Страница 1 документа synthetic.xml",
        },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      await screen.findByRole("button", { name: /P002 · Второй параметр/ }),
    );

    await waitFor(() =>
      expect(getRenderedPage).toHaveBeenCalledWith(
        parsingObjectId,
        file.file_id,
        file.artifact_id,
        2,
        expect.any(AbortSignal),
        file.run_id,
      ),
    );
    expect(
      await screen.findByRole(
        "img",
        {
          name: "Страница 2 документа synthetic.xml",
        },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();

    view.unmount();
    view.client.clear();
  });

  it("не запрашивает страницы до успешного завершения обработки", async () => {
    vi.mocked(getParsingStatus).mockResolvedValue({
      schema_version: 1,
      active: true,
      poll_after_ms: 2000,
      items: [
        {
          ...parsedFile,
          state: "processing",
          artifact_id: null,
          pages_completed: 0,
          pages_total: null,
        },
      ],
    });

    const view = renderPage();

    expect(
      await screen.findByText(
        "Страницы появятся после успешного завершения обработки документов.",
      ),
    ).toBeInTheDocument();
    expect(getParseResult).not.toHaveBeenCalled();
    expect(getRenderedPage).not.toHaveBeenCalled();

    view.unmount();
    view.client.clear();
  });

  it("скрывает страницы после отзыва доступа к объекту", async () => {
    vi.mocked(getParsingStatus).mockResolvedValue({
      schema_version: 1,
      active: false,
      poll_after_ms: 2000,
      items: [parsedFile],
    });
    vi.mocked(getParseResult).mockResolvedValue(structuredClone(parseResult));
    const view = renderPage();

    expect(
      await screen.findByRole(
        "img",
        {
          name: "Страница 1 документа synthetic.xml",
        },
        { timeout: 5000 },
      ),
    ).toBeInTheDocument();

    vi.mocked(getObject).mockRejectedValue(new Error("Нет доступа к объекту"));
    await act(() =>
      view.client.invalidateQueries({
        queryKey: queryKeys.objects.detail(parsingObjectId),
        exact: true,
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Нет доступа к объекту",
    );
    expect(
      screen.queryByRole("img", {
        name: "Страница 1 документа synthetic.xml",
      }),
    ).not.toBeInTheDocument();

    view.unmount();
    view.client.clear();
  });
});
