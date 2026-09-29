import { describe, expect, it } from "vitest";
import {
  sheetDocuments,
  sheetId,
} from "../../../test/helpers/sheet-selection-fixture.js";
import { documentFactsFromSnapshot } from "../completeness/completeness-engine.js";
import {
  validateClarificationBatch,
  validateSheetMap,
} from "./identification-contract.js";
import { buildSelectionSnapshot } from "./identification-engine.js";
import { groupResolvedDocuments } from "./identification-grouping.js";
import {
  resolveSheetSet,
  validateRevisionSheetMap,
} from "./sheet-selection.js";

const resolve = (docs = sheetDocuments()) =>
  resolveSheetSet(docs, sheetId(2), { from: "2026-06-01", to: "2026-06-02" });
describe("explicit sheet replacement (synthetic, not document acceptance)", () => {
  it("preserves sheets 2/3/5/6/7 and assigns 1/4/8 to the replacement's physical pages", () => {
    const docs = sheetDocuments();
    const before = structuredClone(docs);
    const result = resolve(docs);
    expect(result.blockers).toEqual([]);
    expect(
      result.selection!.sheets.map((s) => [
        s.label,
        s.revision_id,
        s.page_number,
      ]),
    ).toEqual([
      ["1", sheetId(2), 1],
      ["2", sheetId(1), 2],
      ["3", sheetId(1), 3],
      ["4", sheetId(2), 2],
      ["5", sheetId(1), 5],
      ["6", sheetId(1), 6],
      ["7", sheetId(1), 7],
      ["8", sheetId(2), 3],
    ]);
    expect(docs).toEqual(before);
    expect(result.selection!.chain).toHaveLength(2);
  });
  it("groups explicit partial revisions and selects different sets for distinct work periods", () => {
    const docs = sheetDocuments();
    const early = structuredClone(docs[2]!);
    early.document_id = sheetId(499);
    early.revisions[0]!.revision_id = sheetId(99);
    Object.assign(early.revisions[0]!.fields, {
      number: "99",
      works_from: "2026-04-01",
      works_to: "2026-04-02",
    });
    const grouped = groupResolvedDocuments([...docs, early]);
    expect(
      grouped.documents.find((doc) =>
        doc.revisions.some((rev) => rev.revision_id === sheetId(1)),
      )!.revisions,
    ).toHaveLength(2);
    const snapshot = buildSelectionSnapshot(grouped.documents);
    const late = snapshot.contexts.find(
      (c) => c.actual.revision_id === sheetId(3),
    )!;
    const old = snapshot.contexts.find(
      (c) => c.actual.revision_id === sheetId(99),
    )!;
    expect(late.status).toBe("READY");
    expect(old.status).toBe("READY");
    expect(late.reference!.revision_id).toBe(sheetId(2));
    expect(old.reference!.revision_id).toBe(sheetId(1));
    expect(late.sheet_selection!.reference!.sheets).toHaveLength(8);
    expect(
      old.sheet_selection!.reference!.sheets.every(
        (s) => s.revision_id === sheetId(1),
      ),
    ).toBe(true);
    const fact = documentFactsFromSnapshot(snapshot).find(
      (f) => f.stage === "RD",
    )!;
    expect(fact.revision_ids).toEqual([sheetId(1), sheetId(2)]);
    expect(fact.needs_review).toBe(false);
  });
  it("refuses unknown labels, missing parent map and foreign scope", () => {
    for (const problem of ["label", "map", "scope"] as const) {
      const docs = sheetDocuments();
      if (problem === "label") {
        docs[1]!.revisions[0]!.sheet_map!.sheets[0]!.label = "99";
        docs[1]!.revisions[0]!.sheet_replacement!.replaced_labels[0] = "99";
      } else if (problem === "map") docs[0]!.revisions[0]!.sheet_map = null;
      else docs[0]!.revisions[0]!.fields.scope = "другой этаж";
      expect(resolve(docs).selection).toBeNull();
      expect(resolve(docs).blockers).not.toEqual([]);
    }
  });
  it("requires every page, an immutable source hash, a PDF and distinct pages/labels", () => {
    const docs = sheetDocuments();
    const base = docs[0]!.revisions[0]!;
    const variants = [
      { ...base.sheet_map!, excluded_pages: [1] },
      { ...base.sheet_map!, sheets: base.sheet_map!.sheets.slice(1) },
      { ...base.sheet_map!, source_sha256: "f".repeat(64) },
      {
        ...base.sheet_map!,
        sheets: base.sheet_map!.sheets.map(() => ({
          label: "1",
          page_number: 1,
        })),
      },
    ];
    for (const sheet_map of variants)
      expect(() => validateRevisionSheetMap({ ...base, sheet_map })).toThrow();
    expect(() =>
      validateRevisionSheetMap({
        ...base,
        representations: [{ ...base.representations[0]!, format: "XML" }],
      }),
    ).toThrow();
    expect(() =>
      validateSheetMap({
        ...base.sheet_map,
        sheets: [{ label: " 1", page_number: 1 }],
      }),
    ).toThrow();
    const excluded = {
      ...base,
      sheet_map: {
        ...base.sheet_map!,
        sheets: base.sheet_map!.sheets.slice(1),
        excluded_pages: [1],
      },
    };
    expect(() => validateRevisionSheetMap(excluded)).not.toThrow();
  });
  it("rejects conflicting full replacement, cycles, future or expired/unconfirmed inherited sheets and mixed PDFs", () => {
    for (const problem of [
      "full",
      "cycle",
      "future",
      "expired",
      "approval",
      "mixed",
    ] as const) {
      const docs = sheetDocuments();
      const base = docs[0]!.revisions[0]!;
      const changed = docs[1]!.revisions[0]!;
      if (problem === "full")
        changed.approval.replaces_revision_id = base.revision_id;
      if (problem === "cycle")
        changed.sheet_replacement!.predecessor_revision_id =
          changed.revision_id;
      if (problem === "future") changed.approval.effective_from = "2026-07-01";
      if (problem === "expired") base.approval.effective_to = "2026-05-31";
      if (problem === "approval") base.approval.confirmed = false;
      if (problem === "mixed")
        changed.blockers.push("unsupported_mixed_document");
      expect(resolve(docs).selection).toBeNull();
    }
  });
  it("accepts additive clarification fields and binds selection to maps and decision basis, not per-Run artifact IDs", () => {
    const docs = sheetDocuments();
    const base = docs[0]!.revisions[0]!;
    expect(() =>
      validateClarificationBatch({
        request_id: sheetId(998),
        expected_run_id: sheetId(999),
        basis: "Синтетика",
        documents: [
          {
            document_id: docs[0]!.document_id,
            expected_version: 1,
            revisions: [
              { revision_id: base.revision_id, sheet_map: base.sheet_map },
            ],
          },
        ],
      }),
    ).not.toThrow();
    const first = resolve(docs).selection!.selection_hash;
    base.representations[0]!.artifact_id = sheetId(888);
    expect(resolve(docs).selection!.selection_hash).toBe(first);
    base.sheet_map!.basis = "Другое основание карты";
    expect(resolve(docs).selection!.selection_hash).not.toBe(first);
    const changed = buildSelectionSnapshot(
      groupResolvedDocuments(docs).documents,
    ).contexts.find((c) => c.actual.revision_id === sheetId(3))!;
    base.sheet_map!.basis = "Ещё одно основание";
    expect(
      buildSelectionSnapshot(
        groupResolvedDocuments(docs).documents,
      ).contexts.find((c) => c.actual.revision_id === sheetId(3))!.context_id,
    ).not.toBe(changed.context_id);
  });
});
