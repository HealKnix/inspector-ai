import type {
  ComparisonContext,
  IdentificationDocument,
  IdentificationRevision,
  IdentificationSnapshot,
  ResolvedSheet,
} from "../../src/modules/identification/identification-contract.js";
import type {
  ParseArtifactData,
  ParseBlock,
  ParsePage,
} from "../../src/modules/parsing/parsing-contract.js";

// Synthetic fixtures only; no real documents are used in unit tests.

let order = 0;

export function secText(id: string, text: string, y = 0.3): ParseBlock {
  return {
    id,
    order: order++,
    kind: "text",
    raw_text: text,
    normalized_text: text,
    bbox: [0.1, y, 0.9, y + 0.05],
    confidence: null,
    source: "native",
    structural_path: null,
    table_id: null,
    row: null,
    column: null,
    row_span: null,
    column_span: null,
  };
}

export function secCell(
  id: string,
  tableId: string,
  row: number,
  column: number,
  text: string,
): ParseBlock {
  return {
    ...secText(id, text, 0.3 + row * 0.03),
    kind: "table_cell",
    table_id: tableId,
    row,
    column,
    row_span: 1,
    column_span: 1,
  };
}

export function secPage(
  pageNumber: number,
  blocks: ParseBlock[],
  over: Partial<ParsePage> = {},
): ParsePage {
  return {
    page_number: pageNumber,
    sheet_label: null,
    width: 100,
    height: 100,
    image_key: "00000000-0000-4000-8000-000000000000",
    image_sha256: "c".repeat(64),
    quality: "OK",
    reasons: [],
    transform: {
      coordinate_space: "visible-page-normalized",
      renderer: "synthetic",
      render_width: 100,
      render_height: 100,
      media_box: [0, 0, 100, 100],
      crop_box: [0, 0, 100, 100],
      rotation: 0,
      pdf_to_visible: [1, 0, 0, 1, 0, 0],
      visible_to_pdf: [1, 0, 0, 1, 0, 0],
    },
    // Reading order follows the array position, like the parser emits —
    // construction order of fixture variables must not move a block.
    blocks: blocks.map((block) => ({ ...block, order: order++ })),
    ...over,
  };
}

export function secArtifact(
  sourceSha: string,
  pages: ParsePage[],
): ParseArtifactData {
  order = 0;
  return {
    schema_version: 1,
    source_sha256: sourceSha,
    pipeline_fingerprint: "p".repeat(64),
    versions: { parser: "synthetic" },
    raw_text: pages.flatMap((p) => p.blocks.map((b) => b.raw_text)).join("\n"),
    normalized_text: pages
      .flatMap((p) => p.blocks.map((b) => b.normalized_text))
      .join("\n"),
    quality: "OK",
    reasons: [],
    coverage: {
      total_pages: pages.length,
      readable_pages: pages.length,
      unreadable_pages: 0,
    },
    pages,
  };
}

export function secRevision(
  revisionId: string,
  stage: "PD" | "RD" | "ID",
  representations: {
    file_id: string;
    artifact_id: string;
    artifact_sha256: string;
    source_sha256: string;
  }[],
): IdentificationRevision {
  return {
    revision_id: revisionId,
    fields: { stage, scope: "оси А-Б" },
    candidates: [],
    blockers: [],
    approval: {
      confirmed: true,
      basis: "Синтетическое подтверждение",
      effective_from: "2026-01-01",
      effective_to: null,
      replaces_revision_id: null,
    },
    representations: representations.map((rep) => ({
      ...rep,
      format: "PDF",
      page_count: 1,
    })),
  };
}

export function secSnapshot(input: {
  documents: { document_id: string; revisions: IdentificationRevision[] }[];
  contexts: ComparisonContext[];
}): IdentificationSnapshot {
  return {
    schema_version: 1,
    blockers: [],
    documents: input.documents.map((doc): IdentificationDocument => ({
      document_id: doc.document_id,
      card_version: 1,
      revisions: doc.revisions,
    })),
    contexts: input.contexts,
  };
}

export function readyContext(
  contextId: string,
  reference: { document_id: string; revision_id: string } | null,
  actual: { document_id: string; revision_id: string },
  over: Partial<ComparisonContext> = {},
): ComparisonContext {
  return {
    context_id: contextId,
    scope: "оси А-Б",
    works_period: { from: "2026-01-01", to: "2026-01-31" },
    reference,
    actual,
    status: "READY",
    blockers: [],
    ...over,
  };
}

export function resolvedSheet(over: Partial<ResolvedSheet>): ResolvedSheet {
  return {
    label: "1",
    page_number: 1,
    document_id: "doc",
    revision_id: "rev",
    file_id: "file",
    artifact_id: "artifact",
    artifact_sha256: "b".repeat(64),
    source_sha256: "a".repeat(64),
    ...over,
  };
}
