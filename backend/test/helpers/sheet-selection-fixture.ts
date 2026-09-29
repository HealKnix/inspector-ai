import type {
  IdentificationDocument,
  IdentificationRevision,
} from "../../src/modules/identification/identification-contract.js";

export const sheetId = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export function sheetRevision(
  n: number,
  labels: string[],
  stage: "RD" | "ID" = "RD",
): IdentificationRevision {
  const fileId = sheetId(n + 100);
  return {
    revision_id: sheetId(n),
    fields: {
      stage,
      kind_code: stage === "RD" ? "KJ" : "AOSR",
      code: "RD-1",
      scope: "оси 1–3",
      revision_label: String(n),
      works_from: "2026-06-01",
      works_to: "2026-06-02",
      reference_code: "RD-1",
    },
    representations: [
      {
        file_id: fileId,
        artifact_id: sheetId(n + 200),
        artifact_sha256: "b".repeat(64),
        source_sha256: "a".repeat(64),
        format: "PDF",
        page_count: labels.length,
      },
    ],
    sheet_map: {
      file_id: fileId,
      source_sha256: "a".repeat(64),
      sheets: labels.map((label, index) => ({ label, page_number: index + 1 })),
      excluded_pages: [],
      basis: "Синтетическая ручная карта",
    },
    approval: {
      confirmed: true,
      effective_from: "2026-01-01",
      effective_to: null,
      replaces_revision_id: null,
      basis: "Синтетическое подтверждение",
    },
    candidates: [],
    blockers: [],
  };
}
export function sheetDocuments(): IdentificationDocument[] {
  const base = sheetRevision(1, ["1", "2", "3", "4", "5", "6", "7", "8"]);
  const change = sheetRevision(2, ["1", "4", "8"]);
  change.sheet_replacement = {
    predecessor_revision_id: base.revision_id,
    replaced_labels: ["1", "4", "8"],
    basis: "Синтетическое разрешение на замену",
  };
  change.approval.effective_from = "2026-05-01";
  change.blockers = ["unsupported_partial_replacement"];
  const actual = sheetRevision(3, ["A"], "ID");
  actual.sheet_map = null;
  return [base, change, actual].map((revision, index) => ({
    document_id: sheetId(index + 400),
    card_version: 1,
    revisions: [revision],
  }));
}
