import { apiClient } from "@/api/client";
import {
  sectionAnalysisStartResponseSchema,
  sectionAnalysisStatusSchema,
  type SectionAnalysisStartRequest,
} from "@/api/types/section-analysis";

/**
 * Selected section-analysis task/status for the object's current run.
 * `runId` pins an explicit run; omit it to follow the latest current run —
 * a deep link into a historical protocol still shows the live task state.
 */
export async function getSectionAnalysisStatus(
  objectId: string,
  runId?: string,
  signal?: AbortSignal,
) {
  const response = await apiClient.get<unknown>(
    `/v1/objects/${objectId}/section-analysis`,
    { signal, ...(runId ? { params: { run_id: runId } } : {}) },
  );
  return sectionAnalysisStatusSchema.parse(response.data);
}

/**
 * Idempotent admission: a fresh request_id selects the analysis basis;
 * replaying an old request_id returns its receipt without re-selecting it.
 */
export async function startSectionAnalysis(
  objectId: string,
  body: SectionAnalysisStartRequest,
) {
  const response = await apiClient.post<unknown>(
    `/v1/objects/${objectId}/section-analysis`,
    body,
  );
  return sectionAnalysisStartResponseSchema.parse(response.data);
}
