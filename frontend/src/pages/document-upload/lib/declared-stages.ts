import { DocumentStage } from "../types";

const STORAGE_PREFIX = "inspector-ai:declared-stages:v1:";

const stages = new Set<string>([
  DocumentStage.PD,
  DocumentStage.RD,
  DocumentStage.ID,
]);

export function loadDeclaredStages(
  objectId: string,
): Record<string, DocumentStage> {
  if (typeof window === "undefined") return {};

  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + objectId);
    if (!raw) return {};

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};

    const result: Record<string, DocumentStage> = {};
    for (const [fileId, stage] of Object.entries(parsed)) {
      if (typeof stage === "string" && stages.has(stage)) {
        result[fileId] = stage as DocumentStage;
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function saveDeclaredStages(
  objectId: string,
  entries: Record<string, DocumentStage>,
): Record<string, DocumentStage> {
  const merged = { ...loadDeclaredStages(objectId), ...entries };

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(
        STORAGE_PREFIX + objectId,
        JSON.stringify(merged),
      );
    } catch {
      // Declared stages remain in memory for the current page session.
    }
  }

  return merged;
}
