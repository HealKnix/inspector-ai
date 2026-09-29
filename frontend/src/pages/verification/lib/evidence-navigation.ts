import type { ComparisonSourceTarget } from "@/api/types/composite-comparison";
import type { ParsingFile } from "@/api/types/parsing";
import type { SectionEvidence } from "@/api/types/section-analysis";
import type { ApiFindingDetail } from "@/api/types/verification";

/**
 * Highlightable citation on a rendered page. Scalar evidence fragments and
 * section citations both reduce to this shape — a block id is only unique
 * inside its own source artifact and page.
 */
export interface PageEvidence {
  fileId: string;
  pageNumber: number;
  blockId: string | null;
  quote: string;
  bbox: readonly number[] | null;
}

/** A block id alone is not unique outside its source artifact and page. */
export function evidenceForPage(
  detail: ApiFindingDetail | undefined,
  file: ParsingFile,
  page: number,
): PageEvidence[] {
  if (!detail?.run_id || detail.run_id !== file.run_id || !file.artifact_id)
    return [];
  const scalar = detail.members.flatMap((member) => {
    if (member.file_id !== file.file_id) return [];
    return member.evidence.filter(
      (fragment) =>
        fragment.fileId === file.file_id &&
        fragment.pageNumber === page &&
        (fragment.artifactId ?? member.artifact_id) === file.artifact_id &&
        (!member.artifact_id || member.artifact_id === file.artifact_id),
    );
  });
  const section = (detail.section_analysis?.evidence ?? []).flatMap((item) =>
    item.file_id === file.file_id &&
    item.artifact_id === file.artifact_id &&
    item.page_number === page
      ? [
          {
            fileId: item.file_id,
            pageNumber: item.page_number,
            blockId: item.block_id,
            quote: item.quote,
            bbox: item.bbox,
          },
        ]
      : [],
  );
  return [...scalar, ...section];
}

export function evidenceRectangle(
  bbox: readonly number[] | null,
): [number, number, number, number] | null {
  if (
    !bbox ||
    bbox.length !== 4 ||
    !bbox.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
  )
    return null;
  const [x0, y0, x1, y1] = bbox as [number, number, number, number];
  return x0 < x1 && y0 < y1 ? [x0, y0, x1, y1] : null;
}

export function comparisonSourceTargets(
  detail: ApiFindingDetail | undefined,
  files: readonly ParsingFile[],
): ComparisonSourceTarget[] {
  if (!detail?.run_id) return [];
  return detail.members.flatMap((member) => {
    const file = files.find(
      (candidate) =>
        candidate.file_id === member.file_id &&
        candidate.run_id === detail.run_id &&
        candidate.artifact_id !== null &&
        (!member.artifact_id || candidate.artifact_id === member.artifact_id),
    );
    if (!file?.artifact_id) return [];
    return member.evidence.flatMap((fragment) => {
      if (
        fragment.extractionId !== member.extraction_id ||
        fragment.fileId !== file.file_id ||
        !Number.isSafeInteger(fragment.pageNumber) ||
        fragment.pageNumber < 1 ||
        (fragment.artifactId ?? member.artifact_id) !== file.artifact_id
      )
        return [];
      return [
        {
          extractionId: member.extraction_id,
          fileId: file.file_id,
          artifactId: file.artifact_id,
          page: fragment.pageNumber,
          blockId: fragment.blockId,
          label: file.original_name,
        },
      ];
    });
  });
}

/** Resolvable section citation on an immutable source artifact. */
export interface SectionEvidenceTarget {
  fileId: string;
  artifactId: string;
  page: number;
  blockId: string | null;
  role: SectionEvidence["role"];
  quote: string;
  label: string;
}

/**
 * Section citations resolved against the parsed files the panes can open.
 * No extraction_id/rule_id exist for this path — identity is
 * file+artifact+run+page from the frozen snapshot.
 */
export function sectionEvidenceTargets(
  detail: ApiFindingDetail | undefined,
  files: readonly ParsingFile[],
): SectionEvidenceTarget[] {
  const section = detail?.section_analysis;
  if (!detail?.run_id || !section) return [];
  return section.evidence.flatMap((item) => {
    const file = files.find(
      (candidate) =>
        candidate.file_id === item.file_id &&
        candidate.run_id === detail.run_id &&
        candidate.artifact_id !== null &&
        candidate.artifact_id === item.artifact_id,
    );
    if (
      !file?.artifact_id ||
      !Number.isSafeInteger(item.page_number) ||
      item.page_number < 1
    )
      return [];
    return [
      {
        fileId: file.file_id,
        artifactId: file.artifact_id,
        page: item.page_number,
        blockId: item.block_id,
        role: item.role,
        quote: item.quote,
        label: file.original_name,
      },
    ];
  });
}

/**
 * Parsed-file descriptors for the immutable sources recorded in a section
 * snapshot — the panes need run_id+artifact_id to open the frozen artifact.
 * Names come from the live parsing list when the file is still listed.
 */
export function sectionSourceFiles(
  detail: ApiFindingDetail | undefined,
  files: readonly ParsingFile[],
): ParsingFile[] {
  const section = detail?.section_analysis;
  if (!detail?.run_id || !section) return [];
  const byId = new Map<string, ParsingFile>();
  for (const source of section.sources) {
    if (!source.artifact_id || byId.has(source.file_id)) continue;
    const current = files.find((file) => file.file_id === source.file_id);
    byId.set(source.file_id, {
      file_id: source.file_id,
      process_id: current?.process_id ?? "",
      run_id: detail.run_id,
      artifact_id: source.artifact_id,
      original_name:
        current?.original_name ?? `Источник ${source.file_id.slice(0, 8)}`,
      state: "succeeded",
      attempt: 0,
      pages_completed: 0,
      pages_total: null,
      quality: null,
      reasons: [],
      error_code: null,
      can_retry: false,
    });
  }
  return [...byId.values()];
}
