import {
  sheetMapSchema,
  sheetReplacementSchema,
  type IdentificationEvidence,
  type IdentificationRegistry,
  type IdentificationRevision,
  type RevisionClarification,
} from "@/api/types/identification";
import { z } from "zod";

// These are editor actions, not document statuses. Opening the editor never
// confirms observed candidates or changes the saved map.
export const sheetReviewSchema = z.object({
  mapAction: z.enum(["unchanged", "replace", "clear"]),
  pages: z.array(z.object({ label: z.string(), excluded: z.boolean() })),
  mapBasis: z.string(),
  replacementAction: z.enum(["unchanged", "replace", "clear"]),
  predecessor: z.string(),
  replacedLabels: z.array(z.string()),
  replacementBasis: z.string(),
});
export type SheetReviewValues = z.infer<typeof sheetReviewSchema>;
export type OriginalPageTarget = Pick<
  IdentificationEvidence,
  | "file_id"
  | "artifact_id"
  | "artifact_sha256"
  | "source_sha256"
  | "page_number"
>;

export function sheetMapRepresentation(revision: IdentificationRevision) {
  const [source] = revision.representations;
  return revision.representations.length === 1 &&
    source?.format.toUpperCase() === "PDF" &&
    source.page_count > 0 &&
    source.page_count <= 500 &&
    !revision.blockers.includes("unsupported_mixed_document")
    ? source
    : null;
}

export function initialSheetReview(
  revision: IdentificationRevision,
): SheetReviewValues {
  const source = sheetMapRepresentation(revision);
  const map = revision.sheet_map;
  return {
    mapAction: "unchanged",
    pages: Array.from({ length: source?.page_count ?? 0 }, (_, index) => ({
      label:
        map?.sheets.find((sheet) => sheet.page_number === index + 1)?.label ??
        "",
      excluded: map?.excluded_pages.includes(index + 1) ?? false,
    })),
    mapBasis: map?.basis ?? "",
    replacementAction: "unchanged",
    predecessor: revision.sheet_replacement?.predecessor_revision_id ?? "",
    replacedLabels: revision.sheet_replacement?.replaced_labels ?? [],
    replacementBasis: revision.sheet_replacement?.basis ?? "",
  };
}

const identity = (value?: string) =>
  (value ?? "")
    .trim()
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ru-RU");
export function sheetPredecessors(
  registry: IdentificationRegistry,
  revision: IdentificationRevision,
) {
  return registry.documents.flatMap((document) =>
    document.revisions
      .filter(
        (candidate) =>
          candidate.revision_id !== revision.revision_id &&
          candidate.sheet_map &&
          candidate.fields.kind_code === revision.fields.kind_code &&
          ["stage", "code", "scope"].every((field) => {
            const key = field as "stage" | "code" | "scope";
            return (
              Boolean(identity(revision.fields[key])) &&
              identity(candidate.fields[key]) === identity(revision.fields[key])
            );
          }),
      )
      .map((candidate) => ({ document, revision: candidate })),
  );
}

/** UI choices only; the server resolves approval, scope and time for each context. */
export function predecessorSheetLabels(
  registry: IdentificationRegistry,
  revision: IdentificationRevision,
): string[] {
  const visited = new Set<string>();
  const collect = (current: IdentificationRevision): string[] => {
    if (
      !current.sheet_map ||
      visited.has(current.revision_id) ||
      visited.size >= 32
    )
      return [];
    visited.add(current.revision_id);
    const own = current.sheet_map.sheets.map((sheet) => sheet.label);
    const relation = current.sheet_replacement;
    if (!relation) return own;
    const parent = sheetPredecessors(registry, current).find(
      (item) => item.revision.revision_id === relation.predecessor_revision_id,
    )?.revision;
    if (!parent) return [];
    const previous = collect(parent);
    if (
      !previous.length ||
      relation.replaced_labels.some((label) => !previous.includes(label)) ||
      own.length !== relation.replaced_labels.length ||
      own.some((label) => !relation.replaced_labels.includes(label))
    )
      return [];
    return [
      ...previous.filter((label) => !relation.replaced_labels.includes(label)),
      ...own,
    ];
  };
  return collect(revision);
}

type SheetPatch = Pick<
  RevisionClarification,
  "sheet_map" | "sheet_replacement"
>;
export function buildSheetPatch(
  draft: SheetReviewValues,
  revision: IdentificationRevision,
  registry: IdentificationRegistry,
  fullReplacement: string | null,
): { patch: SheetPatch; error?: never } | { error: string; patch?: never } {
  const patch: SheetPatch = {};
  if (draft.mapAction === "clear") patch.sheet_map = null;
  if (draft.mapAction === "replace") {
    const source = sheetMapRepresentation(revision);
    if (!source || draft.pages.length !== source.page_count)
      return {
        error:
          "Карта доступна для одного PDF до 500 страниц. Проверьте состав документа.",
      };
    if (
      draft.pages.some((page) =>
        page.excluded ? Boolean(page.label.trim()) : !page.label.trim(),
      )
    )
      return {
        error:
          "Для каждой страницы укажите обозначение листа или исключите её. Исключённая страница не должна иметь обозначения.",
      };
    const result = sheetMapSchema.safeParse({
      file_id: source.file_id,
      source_sha256: source.source_sha256,
      sheets: draft.pages.flatMap((page, index) =>
        page.excluded
          ? []
          : [
              {
                label: page.label.trim().normalize("NFC"),
                page_number: index + 1,
              },
            ],
      ),
      excluded_pages: draft.pages.flatMap((page, index) =>
        page.excluded ? [index + 1] : [],
      ),
      basis: draft.mapBasis,
    });
    if (!result.success)
      return {
        error:
          "Проверьте карту: нужен хотя бы один лист, уникальные обозначения до 80 знаков без переносов и основание до 4000 знаков.",
      };
    patch.sheet_map = result.data;
  }
  if (draft.replacementAction === "clear") patch.sheet_replacement = null;
  if (draft.replacementAction === "replace") {
    const result = sheetReplacementSchema.safeParse({
      predecessor_revision_id: draft.predecessor,
      replaced_labels: draft.replacedLabels,
      basis: draft.replacementBasis,
    });
    if (!result.success)
      return {
        error:
          "Выберите предшествующую редакцию, заменяемые листы и укажите основание замены до 4000 знаков.",
      };
    patch.sheet_replacement = result.data;
  }
  const map =
    patch.sheet_map === undefined ? revision.sheet_map : patch.sheet_map;
  const replacement =
    patch.sheet_replacement === undefined
      ? revision.sheet_replacement
      : patch.sheet_replacement;
  if (replacement && fullReplacement)
    return {
      error:
        "Нельзя одновременно заменять редакцию целиком и отдельные листы. Уточните одно из этих решений.",
    };
  if (!Object.keys(patch).length) return { patch };
  if (replacement) {
    if (fullReplacement)
      return {
        error:
          "Нельзя одновременно заменять редакцию целиком и отдельные листы. Уточните одно из этих решений.",
      };
    if (!map)
      return {
        error:
          "Для замены листов сохраните карту этой редакции или явно снимите решение о замене.",
      };
    const predecessor = sheetPredecessors(registry, revision).find(
      (item) =>
        item.revision.revision_id === replacement.predecessor_revision_id,
    )?.revision;
    if (!predecessor?.sheet_map)
      return {
        error:
          "Нужна редакция с картой листов, той же стадией, шифром и областью работ.",
      };
    const previousLabels = new Set(
      predecessorSheetLabels(registry, predecessor),
    );
    const labels = new Set(map.sheets.map((sheet) => sheet.label));
    if (
      replacement.replaced_labels.length !== labels.size ||
      replacement.replaced_labels.some(
        (label) => !previousLabels.has(label) || !labels.has(label),
      )
    )
      return {
        error:
          "Допустима только замена существующих листов 1:1: карта нового файла должна содержать ровно выбранные обозначения без добавления или перенумерации.",
      };
  }
  return { patch };
}
