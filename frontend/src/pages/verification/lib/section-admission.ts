import type { SectionAnalysisStartRequest } from "@/api/types/section-analysis";

/**
 * Admission request kept across an uncertain transport failure. Replaying
 * the same request_id/body returns the recorded receipt instead of
 * reselecting a different basis or starting a duplicate provider cycle;
 * a confirmed admission or a different run mints a deliberate new request.
 */
export function nextSectionAdmission(
  pending: SectionAnalysisStartRequest | null,
  runId: string,
  previousConfirmed: boolean,
  createId: () => string = () => crypto.randomUUID(),
): SectionAnalysisStartRequest {
  if (!pending || pending.expected_run_id !== runId || previousConfirmed) {
    return { request_id: createId(), expected_run_id: runId };
  }
  return pending;
}
