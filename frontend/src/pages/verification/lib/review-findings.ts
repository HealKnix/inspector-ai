import type { ApiFinding } from "@/api/types/verification";

/** The review queue contains source-backed questions and saved inspector decisions. */
export function isReviewFinding(finding: ApiFinding): boolean {
  if (finding.decided_at) return true;
  // Section evidence also grounds a candidate when the scalar gate has none.
  const hasEvidence =
    finding.has_evidence || Boolean(finding.section_analysis?.evidence.length);
  if (!hasEvidence) return false;
  return (
    finding.status !== "NOT_APPLICABLE" &&
    finding.status !== "NEGATIVE_VERIFIED" &&
    finding.verdict?.status !== "match" &&
    !finding.gate_reasons?.includes("rule_not_approved")
  );
}
