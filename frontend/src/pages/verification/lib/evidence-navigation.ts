import type { ParsingFile } from "@/api/types/parsing";
import type {
  ApiFindingDetail,
  EvidenceFragment,
} from "@/api/types/verification";

/** A block id alone is not unique outside its source artifact and page. */
export function evidenceForPage(
  detail: ApiFindingDetail | undefined,
  file: ParsingFile,
  page: number,
): EvidenceFragment[] {
  if (!detail?.run_id || detail.run_id !== file.run_id || !file.artifact_id)
    return [];
  return detail.members.flatMap((member) => {
    if (member.file_id !== file.file_id) return [];
    return member.evidence.filter(
      (fragment) =>
        fragment.fileId === file.file_id &&
        fragment.pageNumber === page &&
        (fragment.artifactId ?? member.artifact_id) === file.artifact_id &&
        (!member.artifact_id || member.artifact_id === file.artifact_id),
    );
  });
}

export function evidenceRectangle(
  bbox: number[] | null,
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
