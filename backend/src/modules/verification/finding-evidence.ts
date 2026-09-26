function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function rectangle(value: unknown): boolean {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every(
      (coordinate) =>
        typeof coordinate === "number" &&
        Number.isFinite(coordinate) &&
        coordinate >= 0 &&
        coordinate <= 1,
    )
  )
    return false;
  return value[0] < value[2] && value[1] < value[3];
}

export interface FindingEvidencePreview {
  file_id: string;
  role: "expected" | "actual" | "unknown";
  value: number | string | null;
  value_raw: string | null;
  unit: string | null;
  quote: string;
}

/** First located source in the immutable protocol snapshot. Never infer
 * evidence from a verdict/value alone or select a value from ambiguous proof.
 */
export function frozenFindingEvidencePreview(
  snapshot: unknown,
): FindingEvidencePreview | null {
  const frozen = record(snapshot);
  if (!frozen || !Array.isArray(frozen.members)) return null;
  for (const candidate of frozen.members as unknown[]) {
    const member = record(candidate);
    if (
      !member ||
      !["extracted", "ambiguous"].includes(String(member.status)) ||
      !nonempty(member.extraction_id) ||
      !nonempty(member.file_id) ||
      !Array.isArray(member.evidence)
    )
      continue;
    for (const candidate of member.evidence as unknown[]) {
      const fragment = record(candidate);
      if (!fragment) continue;
      const artifactId = fragment.artifactId ?? member.artifact_id;
      if (
        fragment.extractionId === member.extraction_id &&
        fragment.fileId === member.file_id &&
        nonempty(artifactId) &&
        (member.artifact_id == null || member.artifact_id === artifactId) &&
        nonempty(fragment.quote) &&
        typeof fragment.pageNumber === "number" &&
        Number.isSafeInteger(fragment.pageNumber) &&
        fragment.pageNumber > 0 &&
        (nonempty(fragment.blockId) ||
          nonempty(fragment.structuralPath) ||
          rectangle(fragment.bbox))
      )
        return {
          file_id: member.file_id,
          role:
            member.role === "expected" || member.role === "actual"
              ? member.role
              : "unknown",
          value:
            typeof member.value === "string" ||
            (typeof member.value === "number" && Number.isFinite(member.value))
              ? member.value
              : null,
          value_raw:
            typeof member.value_raw === "string" ? member.value_raw : null,
          unit: typeof member.unit === "string" ? member.unit : null,
          quote: fragment.quote,
        };
    }
  }
  return null;
}

export function hasFrozenFindingEvidence(snapshot: unknown): boolean {
  return frozenFindingEvidencePreview(snapshot) !== null;
}
