import { idRegistry } from "./identification-test-fixtures";
import {
  buildSheetPatch,
  initialSheetReview,
  predecessorSheetLabels,
  sheetPredecessors,
} from "./sheet-review";

// Synthetic maps exercise the agreed API contract, not real approval evidence.
function fixture() {
  const registry = structuredClone(idRegistry);
  const revision = registry.documents[0]!.revisions[0]!;
  revision.fields = {
    stage: "RD",
    code: "SYNTHETIC",
    scope: "Zone A",
    observed_replaced_sheet: "1,4,8",
  };
  revision.representations[0]!.format = "PDF";
  revision.representations[0]!.page_count = 3;
  const draft = initialSheetReview(revision);
  draft.mapAction = "replace";
  draft.pages = [
    { label: "1", excluded: false },
    { label: "01", excluded: false },
    { label: "", excluded: true },
  ];
  draft.mapBasis = "Синтетическая ручная сверка всех страниц";
  return { registry, revision, draft };
}

it("does not populate sheet labels or accept observed candidates on ordinary confirmation", () => {
  const { registry, revision } = fixture();
  const draft = initialSheetReview(revision);
  expect(draft.pages.every((page) => page.label === "" && !page.excluded)).toBe(
    true,
  );
  expect(buildSheetPatch(draft, revision, registry, null)).toEqual({
    patch: {},
  });
});
it("accounts for every physical page and preserves distinct printed labels", () => {
  const { registry, revision, draft } = fixture();
  expect(buildSheetPatch(draft, revision, registry, null)).toEqual({
    patch: {
      sheet_map: {
        file_id: revision.representations[0]!.file_id,
        source_sha256: revision.representations[0]!.source_sha256,
        sheets: [
          { label: "1", page_number: 1 },
          { label: "01", page_number: 2 },
        ],
        excluded_pages: [3],
        basis: draft.mapBasis,
      },
    },
  });
});
it.each([
  "unassigned",
  "duplicate",
  "excluded-label",
  "all-excluded",
  "no-basis",
  "wrong-count",
  "multiline",
])(
  "rejects %s map instead of saving an incomplete or ambiguous decision",
  (kind) => {
    const { registry, revision, draft } = fixture();
    if (kind === "unassigned") draft.pages[0]!.label = "";
    if (kind === "duplicate") draft.pages[0]!.label = "01";
    if (kind === "excluded-label") draft.pages[2]!.label = "2";
    if (kind === "all-excluded")
      draft.pages = draft.pages.map(() => ({ label: "", excluded: true }));
    if (kind === "no-basis") draft.mapBasis = " ";
    if (kind === "wrong-count") draft.pages.pop();
    if (kind === "multiline") draft.pages[0]!.label = "1\n2";
    expect(buildSheetPatch(draft, revision, registry, null)).toHaveProperty(
      "error",
    );
  },
);
it.each(["mixed", "multiple", "too-large"])(
  "does not offer an editable map for %s sources",
  (kind) => {
    const { registry, revision, draft } = fixture();
    if (kind === "mixed") revision.blockers = ["unsupported_mixed_document"];
    if (kind === "multiple")
      revision.representations.push({ ...revision.representations[0]! });
    if (kind === "too-large") revision.representations[0]!.page_count = 501;
    expect(initialSheetReview(revision).pages).toEqual([]);
    expect(buildSheetPatch(draft, revision, registry, null)).toHaveProperty(
      "error",
    );
  },
);
it("requires a 1:1 map of existing predecessor labels and does not infer approval", () => {
  const { registry, revision, draft } = fixture();
  const parent = structuredClone(revision);
  parent.revision_id = "33333333-3333-4333-8333-333333333333";
  parent.sheet_map = {
    file_id: parent.representations[0]!.file_id,
    source_sha256: parent.representations[0]!.source_sha256,
    sheets: [
      { label: "1", page_number: 1 },
      { label: "01", page_number: 2 },
      { label: "8", page_number: 3 },
    ],
    excluded_pages: [],
    basis: "Синтетическое основание",
  };
  registry.documents[0]!.revisions.push(parent);
  draft.replacementAction = "replace";
  draft.predecessor = parent.revision_id;
  draft.replacedLabels = ["1", "01"];
  draft.replacementBasis = "Синтетическое разрешение";
  const result = buildSheetPatch(draft, revision, registry, null);
  expect(result.patch?.sheet_replacement?.replaced_labels).toEqual(["1", "01"]);
  expect(result.patch).not.toHaveProperty("approval");
  draft.replacedLabels = ["1", "8"];
  expect(buildSheetPatch(draft, revision, registry, null)).toHaveProperty(
    "error",
  );
  draft.replacedLabels = ["1", "01"];
  draft.pages[1]!.label = "2";
  expect(buildSheetPatch(draft, revision, registry, null)).toHaveProperty(
    "error",
  );
});
it("rejects full replacement even when a saved partial relation was not edited", () => {
  const { registry, revision } = fixture();
  revision.sheet_replacement = {
    predecessor_revision_id: "33333333-3333-4333-8333-333333333333",
    replaced_labels: ["1"],
    basis: "Сохранённое синтетическое решение",
  };
  expect(
    buildSheetPatch(
      initialSheetReview(revision),
      revision,
      registry,
      revision.sheet_replacement.predecessor_revision_id,
    ),
  ).toHaveProperty("error");
  const draft = initialSheetReview(revision);
  draft.mapAction = "clear";
  expect(buildSheetPatch(draft, revision, registry, null)).toHaveProperty(
    "error",
  );
  draft.replacementAction = "clear";
  expect(buildSheetPatch(draft, revision, registry, null)).toEqual({
    patch: { sheet_map: null, sheet_replacement: null },
  });
});
it("offers inherited labels from a chain and refuses circular or unrelated predecessors", () => {
  const { registry, revision } = fixture();
  revision.sheet_map = {
    file_id: revision.representations[0]!.file_id,
    source_sha256: revision.representations[0]!.source_sha256,
    sheets: [
      { label: "1", page_number: 1 },
      { label: "4", page_number: 2 },
      { label: "8", page_number: 3 },
    ],
    excluded_pages: [],
    basis: "Синтетическая карта",
  };
  const next = structuredClone(revision);
  next.revision_id = "33333333-3333-4333-8333-333333333333";
  next.sheet_map!.sheets = [{ label: "1", page_number: 1 }];
  next.sheet_map!.excluded_pages = [2, 3];
  next.sheet_replacement = {
    predecessor_revision_id: revision.revision_id,
    replaced_labels: ["1"],
    basis: "Синтетическая замена",
  };
  registry.documents[0]!.revisions.push(next);
  expect(predecessorSheetLabels(registry, next)).toEqual(["4", "8", "1"]);
  next.fields.scope = "Other";
  expect(sheetPredecessors(registry, revision)).toEqual([]);
  next.fields.scope = revision.fields.scope;
  revision.sheet_replacement = {
    predecessor_revision_id: next.revision_id,
    replaced_labels: ["1", "4", "8"],
    basis: "Синтетический цикл",
  };
  expect(predecessorSheetLabels(registry, next)).toEqual([]);
});
