import type { ApiFinding } from "@/api/types/verification";

/** The review queue contains source-backed questions and saved inspector decisions. */
export function isReviewFinding(finding: ApiFinding): boolean {
  if (finding.decided_at) return true;
  if (!finding.has_evidence) return false;
  return (
    finding.status !== "NOT_APPLICABLE" &&
    finding.status !== "NEGATIVE_VERIFIED" &&
    finding.verdict?.status !== "match" &&
    !finding.gate_reasons?.includes("rule_not_approved")
  );
}
