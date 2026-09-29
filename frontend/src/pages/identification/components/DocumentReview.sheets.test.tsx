import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { resolvedSheetFixture } from "../lib/resolved-sheet-test-fixtures";
import { DocumentReview } from "./DocumentReview";
import type { OriginalDocumentView } from "./OriginalDocumentView";
import type { RevisionForm } from "./RevisionForm";

vi.mock("@/api/hooks/use-classification", () => ({
  useKindOptions: () => ({ data: { options: [] } }),
}));
vi.mock("@/api/hooks/use-identification", () => ({
  useApplyIdentification: () => ({ isPending: false, mutateAsync: vi.fn() }),
  identificationErrorMessage: () => "Ошибка",
}));
vi.mock("./OriginalDocumentView", () => ({
  OriginalDocumentView: (
    props: ComponentProps<typeof OriginalDocumentView>,
  ) => (
    <div
      data-testid="viewer"
      data-revision={props.revision.revision_id}
      data-artifact={props.pageTarget?.artifact_id ?? ""}
      data-source-hash={props.pageTarget?.source_sha256 ?? ""}
      data-page={props.pageTarget?.page_number ?? ""}
      data-run={props.runId}
    />
  ),
}));
vi.mock("./RevisionForm", () => ({
  RevisionForm: (props: ComponentProps<typeof RevisionForm>) => (
    <div data-testid="editor" data-revision={props.revision.revision_id} />
  ),
}));
vi.mock("./FieldCandidates", () => ({ FieldCandidates: () => null }));
vi.mock("./IdentificationHistory", () => ({
  IdentificationHistory: () => null,
}));
afterEach(cleanup);

it("switches inherited → replacement → original without switching the edited revision or snapshot", () => {
  const fixture = resolvedSheetFixture();
  const callbacks = {
    unavailable: false,
    onReload: vi.fn(() => Promise.resolve()),
    onApplied: vi.fn(),
    objectId: fixture.registry.object_id,
  };
  const view = render(<DocumentReview {...fixture} {...callbacks} />);
  fireEvent.click(
    screen.getByRole("button", {
      name: "Открыть лист Л-1, эталонный набор, страница PDF 1",
    }),
  );
  expect(screen.getByTestId("viewer")).toHaveAttribute(
    "data-revision",
    fixture.base.revision_id,
  );
  expect(screen.getByTestId("viewer")).toHaveAttribute(
    "data-artifact",
    fixture.base.representations[0]!.artifact_id,
  );
  expect(screen.getByTestId("editor")).toHaveAttribute(
    "data-revision",
    fixture.revision.revision_id,
  );
  const changedRegistry = structuredClone(fixture.registry);
  changedRegistry.run_id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  changedRegistry.documents[1]!.revisions[1]!.representations[0]!.source_sha256 =
    "0".repeat(64);
  view.rerender(
    <DocumentReview {...fixture} {...callbacks} registry={changedRegistry} />,
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "Открыть лист Л-2, эталонный набор, страница PDF 1",
    }),
  );
  expect(screen.getByTestId("viewer")).toHaveAttribute(
    "data-revision",
    fixture.head.revision_id,
  );
  expect(screen.getByTestId("viewer")).toHaveAttribute(
    "data-source-hash",
    fixture.head.representations[0]!.source_sha256,
  );
  expect(screen.getByTestId("viewer")).toHaveAttribute(
    "data-run",
    fixture.registry.run_id,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Вернуться к документу карточки" }),
  );
  expect(screen.getByTestId("viewer")).toHaveAttribute(
    "data-revision",
    fixture.revision.revision_id,
  );
  expect(screen.getByTestId("viewer")).toHaveAttribute("data-artifact", "");
  expect(callbacks.onApplied).not.toHaveBeenCalled();
});
