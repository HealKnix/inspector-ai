import { createHash } from "node:crypto";
import { canonicalJson } from "../documents/canonical-json.js";
import type {
  ComparisonContext,
  IdentificationSnapshot,
  ResolvedSheetSet,
} from "../identification/identification-contract.js";
import type { ParseArtifactData } from "../parsing/parsing-contract.js";
import type { ExtractionOutcome } from "./extraction-contract.js";
import { executeArtifact, type ApprovedRule } from "./extraction-engine.js";

export type SelectedExtractionOutcome = ExtractionOutcome & {
  selection_key: string | null;
};

export function sheetSelectionKey(
  context: ComparisonContext,
  role: "actual" | "reference",
  selection: ResolvedSheetSet,
): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        context: context.context_id,
        role,
        selection: selection.selection_hash,
      }),
    )
    .digest("hex");
}

/** Ephemeral view: locators retain physical page numbers and the original PAR is never changed. */
export function selectedArtifactView(
  artifact: ParseArtifactData,
  artifactId: string,
  selection: ResolvedSheetSet,
): ParseArtifactData {
  const sheets = selection.sheets.filter(
    (sheet) => sheet.artifact_id === artifactId,
  );
  if (
    !sheets.length ||
    sheets.some((sheet) => sheet.source_sha256 !== artifact.source_sha256) ||
    new Set(sheets.map((sheet) => sheet.page_number)).size !== sheets.length
  )
    throw new Error("sheet_selection_source_mismatch");
  const selectedPages = sheets
    .map((sheet) => {
      const page = artifact.pages.find(
        (page) => page.page_number === sheet.page_number,
      );
      if (!page) throw new Error("sheet_selection_page_missing");
      return { ...structuredClone(page), sheet_label: sheet.label };
    })
    .sort((a, b) => a.page_number - b.page_number);
  const readable = selectedPages.filter(
    (page) => page.quality !== "ABSTAIN",
  ).length;
  return {
    ...artifact,
    pages: selectedPages,
    raw_text: selectedPages
      .flatMap((page) => page.blocks.map((block) => block.raw_text))
      .join("\n"),
    normalized_text: selectedPages
      .flatMap((page) => page.blocks.map((block) => block.normalized_text))
      .join("\n"),
    coverage: {
      total_pages: selectedPages.length,
      readable_pages: readable,
      unreadable_pages: selectedPages.length - readable,
    },
    quality:
      readable === 0
        ? "ABSTAIN"
        : selectedPages.every((page) => page.quality === "OK")
          ? "OK"
          : "LOW_QUALITY",
  };
}

/** Selection precedes anchors/regex/tables/cascade: filtering the first result afterwards is unsafe. */
export function executeSelectedArtifact(
  artifact: ParseArtifactData,
  artifactId: string,
  snapshot: IdentificationSnapshot,
  rules: ApprovedRule[],
): SelectedExtractionOutcome[] {
  const views = new Map<string, ResolvedSheetSet>();
  for (const context of snapshot.contexts) {
    for (const role of ["reference", "actual"] as const) {
      const selection = context.sheet_selection?.[role];
      if (selection?.sheets.some((sheet) => sheet.artifact_id === artifactId))
        views.set(sheetSelectionKey(context, role, selection), selection);
    }
  }
  const revisions = snapshot.documents
    .flatMap((document) => document.revisions)
    .filter((revision) =>
      revision.representations.some((rep) => rep.artifact_id === artifactId),
    );
  const outcomes: SelectedExtractionOutcome[] = revisions.some(
    (revision) => revision.sheet_map || revision.sheet_replacement,
  )
    ? []
    : executeArtifact(artifact, rules).map((outcome) => ({
        ...outcome,
        selection_key: null,
      }));
  for (const [selection_key, selection] of views) {
    const view = selectedArtifactView(artifact, artifactId, selection);
    outcomes.push(
      ...executeArtifact(view, rules).map((outcome) => ({
        ...outcome,
        selection_key,
      })),
    );
  }
  return outcomes;
}
