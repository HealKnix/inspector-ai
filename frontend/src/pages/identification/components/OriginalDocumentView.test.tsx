import type {
  IdentificationEvidence,
  IdentificationRevision,
} from "@/api/types/identification";
import type { ParseResult } from "@/api/types/parsing";
import { parseResult } from "@/api/types/parsing-test-fixtures";
import type { RenderedDocumentPageProps } from "@/components/rendered-document-page/RenderedDocumentPage";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { idRegistry } from "../lib/identification-test-fixtures";
import type { OriginalPageTarget } from "../lib/sheet-review";
import { OriginalDocumentView } from "./OriginalDocumentView";

const { get } = vi.hoisted(() => ({
  get: vi.fn<(url: string, options?: unknown) => Promise<{ data: unknown }>>(),
}));
vi.mock("@/api/client", () => ({ apiClient: { get } }));
vi.mock("@/components/rendered-document-page/RenderedDocumentPage", () => ({
  RenderedDocumentPage: ({
    file,
    page,
    selectedId,
    matchIds,
  }: RenderedDocumentPageProps) => (
    <div
      data-testid="rendered-page"
      data-file-id={file.file_id}
      data-run-id={file.run_id}
      data-artifact-id={file.artifact_id}
      data-page-number={page.page_number}
      data-selected-id={selectedId ?? ""}
      data-match-ids={[...matchIds].join(",")}
    />
  ),
}));

const historicalRun = "77777777-7777-4777-8777-777777777777";

function source() {
  const result: ParseResult = structuredClone(parseResult);
  result.run_id = historicalRun;
  const firstPage = result.artifact.pages[0]!;
  result.artifact.pages = [1, 2, 3].map((pageNumber) => ({
    ...structuredClone(firstPage),
    page_number: pageNumber,
    sheet_label: `Л-${pageNumber}`,
    blocks: firstPage.blocks.map((block) => ({
      ...block,
      id: `block-${pageNumber}`,
    })),
  }));
  result.artifact.coverage = {
    total_pages: 3,
    readable_pages: 3,
    unreadable_pages: 0,
  };
  const revision: IdentificationRevision = structuredClone(
    idRegistry.documents[0]!.revisions[0]!,
  );
  revision.representations[0]!.page_count = 3;
  const evidence: IdentificationEvidence = {
    ...revision.candidates[0]!.evidence[0]!,
    page_number: 2,
    block_id: "block-2",
    quote: "Сохранённая цитата со второй страницы",
  };
  return { result, revision, evidence };
}

function mount(
  revision: IdentificationRevision,
  evidence: IdentificationEvidence | null = null,
  pageTarget: OriginalPageTarget | null = null,
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <OriginalDocumentView
        objectId={idRegistry.object_id}
        processId={idRegistry.process_id}
        runId={historicalRun}
        revision={revision}
        filenames={new Map([[parseResult.file_id, "synthetic.xml"]])}
        evidence={evidence}
        pageTarget={pageTarget}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.resetAllMocks());

it("requests and renders the exact historical file, run and artifact", async () => {
  const { result, revision } = source();
  get.mockResolvedValue({ data: result });
  mount(revision);
  const page = await screen.findByTestId("rendered-page");
  expect(get).toHaveBeenCalledOnce();
  expect(get.mock.calls[0]?.[0]).toBe(
    `/v1/objects/${idRegistry.object_id}/files/${result.file_id}/parse`,
  );
  expect(get.mock.calls[0]?.[1]).toMatchObject({
    params: { run_id: historicalRun, artifact_id: result.artifact_id },
  });
  expect(page).toHaveAttribute("data-file-id", result.file_id);
  expect(page).toHaveAttribute("data-run-id", historicalRun);
  expect(page).toHaveAttribute("data-artifact-id", result.artifact_id);
});

it("does not render a page from a different source hash", async () => {
  const { result, revision, evidence } = source();
  result.artifact.source_sha256 = "f".repeat(64);
  get.mockResolvedValue({ data: result });
  mount(revision, evidence);
  expect(
    await screen.findByText(/Не удалось открыть сохранённую страницу/),
  ).toBeInTheDocument();
  expect(screen.queryByTestId("rendered-page")).not.toBeInTheDocument();
  expect(screen.queryByText(evidence.quote)).not.toBeInTheDocument();
});

it.each(["file_id", "run_id", "artifact_id"] as const)(
  "rejects a response with a different %s instead of showing the newer source",
  async (field) => {
    const { result, revision } = source();
    result[field] = "99999999-9999-4999-8999-999999999999";
    get.mockResolvedValue({ data: result });
    mount(revision);
    expect(
      await screen.findByText(/Не удалось открыть сохранённую страницу/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("rendered-page")).not.toBeInTheDocument();
  },
);

it("shows a quote and highlight only on their exact page while paging the original", async () => {
  const { result, revision, evidence } = source();
  get.mockResolvedValue({ data: result });
  mount(revision, evidence);
  const page = await screen.findByTestId("rendered-page");
  expect(page).toHaveAttribute("data-page-number", "2");
  expect(page).toHaveAttribute("data-selected-id", "block-2");
  expect(page).toHaveAttribute("data-match-ids", "block-2");
  expect(screen.getByText(evidence.quote)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Далее" }));
  expect(page).toHaveAttribute("data-page-number", "3");
  expect(page).toHaveAttribute("data-selected-id", "");
  expect(page).toHaveAttribute("data-match-ids", "");
  expect(screen.queryByText(evidence.quote)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Назад" }));
  expect(page).toHaveAttribute("data-page-number", "2");
  expect(page).toHaveAttribute("data-selected-id", "block-2");
  expect(screen.getByText(evidence.quote)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Назад" }));
  expect(page).toHaveAttribute("data-page-number", "1");
  expect(page).toHaveAttribute("data-selected-id", "");
  expect(page).toHaveAttribute("data-match-ids", "");
  expect(screen.queryByText(evidence.quote)).not.toBeInTheDocument();
  expect(get).toHaveBeenCalledOnce();
});

it("opens a map's physical page without a fabricated quote or highlight", async () => {
  const { result, revision } = source();
  get.mockResolvedValue({ data: result });
  mount(revision, null, { ...revision.representations[0]!, page_number: 3 });
  const page = await screen.findByTestId("rendered-page");
  expect(page).toHaveAttribute("data-page-number", "3");
  expect(page).toHaveAttribute("data-selected-id", "");
  expect(page).toHaveAttribute("data-match-ids", "");
});

it.each(["missing", "source-hash"])(
  "does not substitute a different page for a %s map target",
  async (mode) => {
    const { result, revision } = source();
    get.mockResolvedValue({ data: result });
    const target = { ...revision.representations[0]!, page_number: 3 };
    if (mode === "missing") target.page_number = 4;
    else target.source_sha256 = "f".repeat(64);
    mount(revision, null, target);
    expect(
      await screen.findByText(/Не удалось открыть сохранённую страницу/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("rendered-page")).not.toBeInTheDocument();
  },
);
