import type { ProtocolRecord } from "@/types/protocols";

type ProtocolViolation = ProtocolRecord["violations"][number];

export interface ProtocolSummary {
  totalCount: number;
  criticalCount: number;
  significantCount: number;
  confirmedCount: number;
}

const violationCategoryLabels = {
  critical: "Критическое",
  significant: "Существенное",
} as const satisfies Record<ProtocolViolation["category"], string>;

export function formatProtocolDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
}

export function getProtocolSummary(
  violations: readonly ProtocolViolation[],
): ProtocolSummary {
  return violations.reduce<ProtocolSummary>(
    (summary, violation) => {
      summary.totalCount += 1;
      if (violation.category === "critical") summary.criticalCount += 1;
      if (violation.category === "significant") {
        summary.significantCount += 1;
      }
      if (violation.inspectorDecision === "Подтверждено") {
        summary.confirmedCount += 1;
      }
      return summary;
    },
    {
      totalCount: 0,
      criticalCount: 0,
      significantCount: 0,
      confirmedCount: 0,
    },
  );
}

export function filterProtocols(
  protocols: readonly ProtocolRecord[],
  objectId: string,
  query: string,
): ProtocolRecord[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");

  return protocols
    .filter((protocol) => !objectId || protocol.objectId === objectId)
    .filter(
      (protocol) =>
        normalizedQuery.length === 0 ||
        [
          protocol.id,
          protocol.objectName,
          formatProtocolDate(protocol.checkedAt),
        ]
          .join(" ")
          .toLocaleLowerCase("ru-RU")
          .includes(normalizedQuery),
    )
    .sort((first, second) => second.checkedAt.localeCompare(first.checkedAt));
}

export function filterProtocolViolations(
  violations: readonly ProtocolViolation[],
  query: string,
): ProtocolViolation[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("ru-RU");
  if (normalizedQuery.length === 0) return [...violations];

  return violations.filter((violation) => {
    const category = violationCategoryLabels[violation.category];

    return [
      String(violation.ordinal),
      category,
      violation.section,
      violation.parameter,
      violation.code,
      violation.pdValue,
      violation.rdValue,
      violation.idValue,
      violation.deviation,
      violation.inspectorDecision,
    ].some((value) =>
      value.toLocaleLowerCase("ru-RU").includes(normalizedQuery),
    );
  });
}
