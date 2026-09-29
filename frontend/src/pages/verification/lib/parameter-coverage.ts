import type { ApiFinding, ApiFindingStatus } from "@/api/types/verification";

export const MATRIX_PARAMETER_TARGET = 132;
export const coverageStatusLabels: Record<ApiFindingStatus, string> = {
  CANDIDATE: "Кандидат на нарушение",
  CONFIRMED_VIOLATION: "Нарушение подтверждено",
  NEGATIVE_VERIFIED: "Отрицательный результат / совпадение",
  CLARIFICATION_REQUIRED: "Нужно уточнение",
  MISSING_EVIDENCE: "Недостаточно доказательств",
  NOT_COMPARABLE: "Несопоставимо",
  NOT_APPLICABLE: "Неприменимо",
};

/** A parameter may have several scopes and outcomes; never count each scope as
 * another matrix parameter or interpret an unresolved outcome as a match. */
export function parameterCoverage(items: readonly ApiFinding[] | undefined) {
  if (!items) return null;
  const byCode = new Map<string, ApiFinding[]>();
  const statusCounts = Object.fromEntries(
    Object.keys(coverageStatusLabels).map((status) => [status, 0]),
  ) as Record<ApiFindingStatus, number>;
  const unavailableRules = new Set<string>();
  for (const item of items) {
    byCode.set(item.parameter_code, [
      ...(byCode.get(item.parameter_code) ?? []),
      item,
    ]);
    statusCounts[item.status] += 1;
    if (item.gate_reasons?.includes("rule_not_approved"))
      unavailableRules.add(item.parameter_code);
  }
  return {
    observedParameters: byCode.size,
    controlPoints: items.length,
    unavailableRules: unavailableRules.size,
    statusCounts,
    parameters: [...byCode.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, findings]) => ({ code, findings })),
  };
}
