import { idRegistry } from "./identification-test-fixtures";
import type { ResolvedSheetSelection } from "./resolved-sheet-selection";

/** Explicit synthetic revisions: leaf 1 is inherited, leaf 2 is replaced. */
export function resolvedSheetFixture() {
  const registry = structuredClone(idRegistry);
  const document = registry.documents[0]!;
  const revision = document.revisions[0]!;
  const referenceDocumentId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const base = structuredClone(revision);
  base.revision_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  base.fields = {
    stage: "RD",
    code: "SYNTHETIC",
    scope: "Область А",
    revision_label: "0",
  };
  base.candidates = [];
  base.representations = [
    {
      file_id: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
      artifact_id: "aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa",
      artifact_sha256: "a".repeat(64),
      source_sha256: "b".repeat(64),
      format: "PDF",
      page_count: 3,
    },
  ];
  const sourceBase = base.representations[0]!;
  base.sheet_map = {
    file_id: sourceBase.file_id,
    source_sha256: sourceBase.source_sha256,
    sheets: [
      { label: "Л-1", page_number: 1 },
      { label: "Л-2", page_number: 3 },
    ],
    excluded_pages: [2],
    basis: "Синтетическая карта базовой редакции",
  };
  const head = structuredClone(base);
  head.revision_id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  head.fields.revision_label = "1";
  head.representations = [
    {
      file_id: "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb",
      artifact_id: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
      artifact_sha256: "c".repeat(64),
      source_sha256: "d".repeat(64),
      format: "PDF",
      page_count: 1,
    },
  ];
  const sourceHead = head.representations[0]!;
  head.sheet_map = {
    file_id: sourceHead.file_id,
    source_sha256: sourceHead.source_sha256,
    sheets: [{ label: "Л-2", page_number: 1 }],
    excluded_pages: [],
    basis: "Синтетическая карта новой редакции",
  };
  head.sheet_replacement = {
    predecessor_revision_id: base.revision_id,
    replaced_labels: ["Л-2"],
    basis: "Синтетическое разрешение на замену Л-2",
  };
  registry.documents.push({
    document_id: referenceDocumentId,
    card_version: 1,
    revisions: [base, head],
  });
  const selection: ResolvedSheetSelection = {
    selection_hash: "e".repeat(64),
    chain: [
      { revision_id: base.revision_id, decision_hash: "f".repeat(64) },
      { revision_id: head.revision_id, decision_hash: "1".repeat(64) },
    ],
    sheets: [
      {
        label: "Л-1",
        page_number: 1,
        document_id: referenceDocumentId,
        revision_id: base.revision_id,
        file_id: sourceBase.file_id,
        artifact_id: sourceBase.artifact_id,
        source_sha256: sourceBase.source_sha256,
        artifact_sha256: sourceBase.artifact_sha256,
      },
      {
        label: "Л-2",
        page_number: 1,
        document_id: referenceDocumentId,
        revision_id: head.revision_id,
        file_id: sourceHead.file_id,
        artifact_id: sourceHead.artifact_id,
        source_sha256: sourceHead.source_sha256,
        artifact_sha256: sourceHead.artifact_sha256,
      },
    ],
  };
  registry.contexts = [
    {
      context_id: "synthetic-context",
      scope: "Область А",
      works_period: { from: null, to: null },
      reference: {
        document_id: referenceDocumentId,
        revision_id: head.revision_id,
      },
      actual: {
        document_id: document.document_id,
        revision_id: revision.revision_id,
      },
      status: "READY",
      blockers: [],
      sheet_selection: { reference: selection, actual: null },
    },
  ];
  const filenames = new Map([
    [sourceBase.file_id, "base.pdf"],
    [sourceHead.file_id, "new.pdf"],
  ]);
  return { registry, document, revision, base, head, selection, filenames };
}
