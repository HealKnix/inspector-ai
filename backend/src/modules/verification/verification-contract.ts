// Contract v1 for the verification domain (design D2–D7). Finding statuses
// merge the §9.2 outcome scale with the §9.3 verification result; service
// states never carry an inspector decision.

import type { ParameterGate } from "../completeness/completeness-contract.js";
import type { VerdictStatus } from "../extraction/comparison-engine.js";

export const VERIFICATION_SCHEMA_VERSION = 1;

export type FindingStatusValue =
  | "CANDIDATE"
  | "CONFIRMED_VIOLATION"
  | "NEGATIVE_VERIFIED"
  | "CLARIFICATION_REQUIRED"
  | "MISSING_EVIDENCE"
  | "NOT_COMPARABLE"
  | "NOT_APPLICABLE";

export type DecisionAction = "confirm" | "reject" | "clarify" | "reopen";

// Machine codes for a rejection reason; UI labels live in the frontend
// (DiscrepancyDetails rejectionReasons) and map 1:1 by index order there.
export const REJECTION_REASON_CODES = [
  "wrong_revision",
  "approved_change",
  "ocr_error",
  "evidence_binding_error",
  "not_applicable",
  "no_discrepancy",
] as const;

export type RejectionReasonCode = (typeof REJECTION_REASON_CODES)[number];

/** Статусы, над которыми инспектор вообще может принимать решение. */
export const DECIDABLE_STATUSES: readonly FindingStatusValue[] = [
  "CANDIDATE",
  "CONFIRMED_VIOLATION",
  "NEGATIVE_VERIFIED",
  "CLARIFICATION_REQUIRED",
];

const TRANSITIONS: Record<
  DecisionAction,
  { from: FindingStatusValue[]; to: FindingStatusValue }
> = {
  confirm: { from: ["CANDIDATE"], to: "CONFIRMED_VIOLATION" },
  reject: { from: ["CANDIDATE"], to: "NEGATIVE_VERIFIED" },
  clarify: { from: ["CANDIDATE"], to: "CLARIFICATION_REQUIRED" },
  reopen: {
    from: [
      "CLARIFICATION_REQUIRED",
      "CONFIRMED_VIOLATION",
      "NEGATIVE_VERIFIED",
    ],
    to: "CANDIDATE",
  },
};

export function decisionTarget(
  action: DecisionAction,
  status: FindingStatusValue,
): FindingStatusValue | null {
  const transition = TRANSITIONS[action];
  return transition.from.includes(status) ? transition.to : null;
}

/** Авто-негатив (verdict match) и ручное отклонение делят один статус —
 * их различает наличие решения; решать авто-негатив повторно можно
 * только через reopen. */
export const AUTO_NEGATIVE_STATUSES: readonly FindingStatusValue[] = [
  "NEGATIVE_VERIFIED",
];

export function statusForVerdict(status: VerdictStatus): FindingStatusValue {
  switch (status) {
    case "discrepancy":
      return "CANDIDATE";
    case "match":
      return "NEGATIVE_VERIFIED";
    case "expected_missing":
    case "actual_missing":
      return "MISSING_EVIDENCE";
    case "expected_ambiguous":
    case "actual_ambiguous":
      return "CLARIFICATION_REQUIRED";
    default:
      return "NOT_COMPARABLE";
  }
}

export function statusForGate(gate: ParameterGate): FindingStatusValue | null {
  switch (gate) {
    case "NOT_APPLICABLE":
      return "NOT_APPLICABLE";
    case "MISSING_EVIDENCE":
      return "MISSING_EVIDENCE";
    case "CLARIFICATION_REQUIRED":
      return "CLARIFICATION_REQUIRED";
    default:
      return null;
  }
}
