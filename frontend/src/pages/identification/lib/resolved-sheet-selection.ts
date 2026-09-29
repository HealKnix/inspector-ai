import type {
  IdentificationRegistry,
  IdentificationRevision,
} from "@/api/types/identification";
import type { OriginalPageTarget } from "./sheet-review";

export type SheetContext = IdentificationRegistry["contexts"][number];
export type ResolvedSheetSelection = NonNullable<
  NonNullable<SheetContext["sheet_selection"]>["reference"]
>;
export type ResolvedSheet = ResolvedSheetSelection["sheets"][number];
export interface ResolvedSheetSource {
  revision: IdentificationRevision;
  pageTarget: OriginalPageTarget;
  mapBasis: string;
}
export interface ResolvedSheetNavigation extends ResolvedSheetSource {
  label: string;
  contextLabel: string;
  roleLabel: string;
}

export function sheetContextsForRevision(
  registry: IdentificationRegistry,
  revisionId: string,
) {
  return registry.contexts.filter(
    (context) =>
      context.sheet_selection &&
      (context.actual.revision_id === revisionId ||
        context.reference?.revision_id === revisionId ||
        [
          context.sheet_selection.reference,
          context.sheet_selection.actual,
        ].some((selection) =>
          selection?.chain.some((entry) => entry.revision_id === revisionId),
        )),
  );
}

/** Resolve exclusively within the reviewed snapshot. A matching display label or
 * file name never substitutes for the saved source identity and physical page. */
export function resolveSelectedSheet(
  registry: IdentificationRegistry,
  selection: ResolvedSheetSelection,
  sheet: ResolvedSheet,
): ResolvedSheetSource | null {
  if (!selection.chain.some((entry) => entry.revision_id === sheet.revision_id))
    return null;
  const document = registry.documents.find(
    (item) => item.document_id === sheet.document_id,
  );
  const revision = document?.revisions.find(
    (item) => item.revision_id === sheet.revision_id,
  );
  if (!revision) return null;
  const source = revision.representations.find(
    (item) =>
      item.file_id === sheet.file_id &&
      item.artifact_id === sheet.artifact_id &&
      item.source_sha256 === sheet.source_sha256 &&
      item.artifact_sha256 === sheet.artifact_sha256,
  );
  const map = revision.sheet_map;
  if (
    !source ||
    !map ||
    source.format.toUpperCase() !== "PDF" ||
    !Number.isSafeInteger(sheet.page_number) ||
    sheet.page_number < 1 ||
    sheet.page_number > source.page_count ||
    map.file_id !== sheet.file_id ||
    map.source_sha256 !== sheet.source_sha256 ||
    !map.sheets.some(
      (item) =>
        item.label === sheet.label && item.page_number === sheet.page_number,
    ) ||
    map.excluded_pages.includes(sheet.page_number)
  )
    return null;
  return {
    revision,
    mapBasis: map.basis,
    pageTarget: {
      file_id: sheet.file_id,
      artifact_id: sheet.artifact_id,
      artifact_sha256: sheet.artifact_sha256,
      source_sha256: sheet.source_sha256,
      page_number: sheet.page_number,
    },
  };
}
