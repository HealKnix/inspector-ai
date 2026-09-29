import type { RevisionClarification } from "@/api/types/identification";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { idRegistry } from "../lib/identification-test-fixtures";
import { RevisionForm } from "./RevisionForm";

const onConfirm =
  vi.fn<(patch: RevisionClarification, basis: string) => void>();
const onPage = vi.fn();
function fixture() {
  const registry = structuredClone(idRegistry);
  const revision = registry.documents[0]!.revisions[0]!;
  revision.fields = {
    stage: "RD",
    code: "SYNTHETIC",
    scope: "A",
    observed_replaced_sheet: "1,4,8",
  };
  revision.representations[0]!.format = "PDF";
  revision.representations[0]!.page_count = 2;
  return { registry, revision };
}
function mount(registry = fixture().registry, disabled = false) {
  return render(
    <RevisionForm
      revision={registry.documents[0]!.revisions[0]!}
      registry={registry}
      filenames={new Map()}
      kindOptions={null}
      disabled={disabled}
      pending={false}
      onConfirm={onConfirm}
      onEvidence={() => undefined}
      onPage={onPage}
    />,
  );
}
function openMap() {
  fireEvent.click(screen.getByText("Карта листов и частичная замена"));
  fireEvent.click(
    screen.getByRole("button", { name: "Уточнить карту листов" }),
  );
}
function save() {
  fireEvent.click(
    screen.getByRole("button", { name: "Сохранить и проверить" }),
  );
}
beforeEach(() => vi.clearAllMocks());

it("saves an explicit map with source hash and exclusion through the single confirmation, without approval", async () => {
  const { registry, revision } = fixture();
  mount(registry);
  openMap();
  expect(screen.getByLabelText("Лист на странице PDF 1")).toHaveValue("");
  expect(screen.getByLabelText("Лист на странице PDF 2")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("Лист на странице PDF 1"), {
    target: { value: "А-1" },
  });
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Исключить страницу PDF 2" }),
  );
  fireEvent.change(
    screen.getByLabelText("Основание карты листов и исключений"),
    { target: { value: "Синтетическая сверка, страница 2 — разрешение" } },
  );
  save();
  await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
  expect(onConfirm.mock.calls[0]![0]).toMatchObject({
    sheet_map: {
      file_id: revision.representations[0]!.file_id,
      source_sha256: revision.representations[0]!.source_sha256,
      sheets: [{ label: "А-1", page_number: 1 }],
      excluded_pages: [2],
      basis: "Синтетическая сверка, страница 2 — разрешение",
    },
  });
  expect(onConfirm.mock.calls[0]![0]).not.toHaveProperty("approval");
  expect(onConfirm.mock.calls[0]![0]).not.toHaveProperty("sheet_replacement");
});
it("shows a missing-page error next to the action and does not submit", async () => {
  mount();
  openMap();
  fireEvent.change(screen.getByLabelText("Лист на странице PDF 1"), {
    target: { value: "1" },
  });
  save();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Для каждой страницы",
  );
  expect(onConfirm).not.toHaveBeenCalled();
});
it("navigates to a physical source page without making up a quote or block", () => {
  const { registry, revision } = fixture();
  mount(registry);
  openMap();
  fireEvent.click(screen.getByRole("button", { name: "Страница PDF 2" }));
  expect(onPage).toHaveBeenCalledWith(
    expect.objectContaining({
      file_id: revision.representations[0]!.file_id,
      artifact_id: revision.representations[0]!.artifact_id,
      page_number: 2,
      source_sha256: revision.representations[0]!.source_sha256,
    }),
  );
  expect(onPage.mock.calls[0]![0]).not.toHaveProperty("block_id");
  expect(onConfirm).not.toHaveBeenCalled();
});
it("keeps a saved historical map and its basis readable with no mutation controls", () => {
  const { registry, revision } = fixture();
  revision.sheet_map = {
    file_id: revision.representations[0]!.file_id,
    source_sha256: revision.representations[0]!.source_sha256,
    sheets: [{ label: "01", page_number: 2 }],
    excluded_pages: [1],
    basis: "Историческое синтетическое основание",
  };
  mount(registry, true);
  fireEvent.click(screen.getByText("Карта листов и частичная замена"));
  expect(screen.getByLabelText("Сохранённая карта листов")).toHaveTextContent(
    "Лист 01",
  );
  expect(screen.getByLabelText("Сохранённая карта листов")).toHaveTextContent(
    "Историческое синтетическое основание",
  );
  expect(
    screen.queryByRole("button", { name: "Уточнить карту листов" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Снять карту листов" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Страница PDF 2" }));
  expect(onPage).toHaveBeenCalledOnce();
});
it("requires an explicit predecessor, labels and basis for a partial replacement", async () => {
  const { registry, revision } = fixture();
  const parent = structuredClone(revision);
  parent.revision_id = "33333333-3333-4333-8333-333333333333";
  parent.fields.revision_label = "0";
  parent.sheet_map = {
    file_id: parent.representations[0]!.file_id,
    source_sha256: parent.representations[0]!.source_sha256,
    sheets: [
      { label: "1", page_number: 1 },
      { label: "4", page_number: 2 },
    ],
    excluded_pages: [],
    basis: "Предыдущая синтетическая карта",
  };
  registry.documents[0]!.revisions.push(parent);
  mount(registry);
  openMap();
  fireEvent.change(screen.getByLabelText("Лист на странице PDF 1"), {
    target: { value: "4" },
  });
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Исключить страницу PDF 2" }),
  );
  fireEvent.change(
    screen.getByLabelText("Основание карты листов и исключений"),
    { target: { value: "Карта синтетического изменения" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Уточнить замену отдельных листов" }),
  );
  fireEvent.click(
    screen.getByLabelText("Предшествующая редакция для замены листов", {
      selector: "button",
    }),
  );
  fireEvent.click(
    await screen.findByRole("option", { name: "SYNTHETIC · редакция 0" }),
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "Заменить лист 4" }));
  save();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "основание замены",
  );
  expect(onConfirm).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Основание замены листов"), {
    target: { value: "Синтетическое разрешение на замену листа 4" },
  });
  save();
  await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
  expect(onConfirm.mock.calls[0]![0].sheet_replacement).toEqual({
    predecessor_revision_id: parent.revision_id,
    replaced_labels: ["4"],
    basis: "Синтетическое разрешение на замену листа 4",
  });
  expect(onConfirm.mock.calls[0]![0]).not.toHaveProperty("approval");
});
