import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  resolveSelectedSheet,
  type ResolvedSheetNavigation,
} from "../lib/resolved-sheet-selection";
import { resolvedSheetFixture } from "../lib/resolved-sheet-test-fixtures";
import { ResolvedSheetSelection } from "./ResolvedSheetSelection";

afterEach(cleanup);
it("shows inherited and replaced physical sources with their saved bases", () => {
  const fixture = resolvedSheetFixture();
  const onOpen = vi.fn<(target: ResolvedSheetNavigation) => void>();
  render(
    <ResolvedSheetSelection {...fixture} unavailable={false} onOpen={onOpen} />,
  );
  expect(screen.getByText("Лист Л-1 → страница PDF 1")).toBeInTheDocument();
  expect(
    screen.getByText(/base.pdf · редакция 0 · сохранён/),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/new.pdf · редакция 1 · из выбранной/),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Замена листов Л-2: Синтетическое разрешение/),
  ).toBeInTheDocument();
  expect(onOpen).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Открыть лист Л-1, эталонный набор, страница PDF 1",
    }),
  );
  expect(onOpen.mock.calls.at(-1)?.[0].revision).toEqual(fixture.base);
  expect(onOpen.mock.calls.at(-1)?.[0].pageTarget).toMatchObject({
    artifact_id: fixture.base.representations[0]!.artifact_id,
    source_sha256: fixture.base.representations[0]!.source_sha256,
    page_number: 1,
  });
  fireEvent.click(
    screen.getByRole("button", {
      name: "Открыть лист Л-2, эталонный набор, страница PDF 1",
    }),
  );
  expect(onOpen.mock.calls.at(-1)?.[0].revision).toEqual(fixture.head);
  expect(onOpen.mock.calls.at(-1)?.[0].pageTarget).toMatchObject({
    artifact_id: fixture.head.representations[0]!.artifact_id,
    page_number: 1,
  });
});
it("never substitutes a current file or another physical page for a saved sheet", () => {
  const { registry, selection } = resolvedSheetFixture();
  const sheet = selection.sheets[0]!;
  expect(resolveSelectedSheet(registry, selection, sheet)).not.toBeNull();
  for (const patch of [
    { artifact_id: selection.sheets[1]!.artifact_id },
    { source_sha256: "0".repeat(64) },
    { artifact_sha256: "0".repeat(64) },
    { document_id: "missing-document" },
    { revision_id: "missing-revision" },
    { page_number: 2 },
    { page_number: 1.5 },
    { label: "Л-2" },
  ]) {
    expect(
      resolveSelectedSheet(registry, selection, { ...sheet, ...patch }),
    ).toBeNull();
  }
  expect(
    resolveSelectedSheet(registry, { ...selection, chain: [] }, sheet),
  ).toBeNull();
});
it("makes missing historical sources and unresolved context explicit", () => {
  const fixture = resolvedSheetFixture();
  fixture.registry.contexts[0]!.status = "CLARIFICATION_REQUIRED";
  fixture.base.representations[0]!.artifact_sha256 = "0".repeat(64);
  render(
    <ResolvedSheetSelection
      {...fixture}
      unavailable={false}
      onOpen={vi.fn()}
    />,
  );
  expect(screen.getByText(/Контекст требует уточнения/)).toBeInTheDocument();
  expect(
    screen.getByText(/Сохранённый источник или его карта недоступны/),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", {
      name: "Открыть лист Л-1, эталонный набор, страница PDF 1",
    }),
  ).not.toBeInTheDocument();
});
it("disables navigation after access becomes unavailable and invents no legacy selection", () => {
  const fixture = resolvedSheetFixture();
  const view = render(
    <ResolvedSheetSelection {...fixture} unavailable onOpen={vi.fn()} />,
  );
  expect(
    screen
      .getAllByRole("button")
      .every((button) => button.hasAttribute("disabled")),
  ).toBe(true);
  fixture.registry.contexts[0]!.sheet_selection = undefined;
  view.rerender(
    <ResolvedSheetSelection
      {...fixture}
      unavailable={false}
      onOpen={vi.fn()}
    />,
  );
  expect(view.container).toBeEmptyDOMElement();
});
