import type { ApiFinding, ProtocolResponse } from "@/api/types/verification";
import { render, screen } from "@testing-library/react";
import {
  filterFindingsByGroup,
  FindingStatusGroup,
  toVerificationFinding,
} from "../lib/object-findings";
import { parameterCoverage } from "../lib/parameter-coverage";
import { isReviewFinding } from "../lib/review-findings";
import { ParameterCoverage } from "./ParameterCoverage";

function finding(
  code: string,
  status: ApiFinding["status"],
  overrides: Partial<ApiFinding> = {},
): ApiFinding {
  return {
    id: `${code}-${status}`,
    parameter_code: code,
    scope_key: "object",
    status,
    risk: null,
    reason_code: null,
    comment: null,
    decided_at: null,
    has_evidence: false,
    evidence_preview: null,
    finding_version: 1,
    gate_reasons: null,
    verdict: null,
    ...overrides,
  };
}
const protocol: NonNullable<ProtocolResponse["protocol"]> = {
  id: "saved-protocol",
  version: 2,
  status: "active",
  scenario: "FULL",
  created_at: "2026-09-27T00:00:00Z",
  finalized_at: null,
  findings: 5,
};

it("keeps missing data unknown instead of displaying zero coverage", () => {
  expect(parameterCoverage(undefined)).toBeNull();
  render(
    <ParameterCoverage
      protocol={protocol}
      items={undefined}
      loading={false}
      error
    />,
  );
  expect(screen.getAllByText("Неизвестно")).toHaveLength(3);
  expect(screen.getByRole("alert")).toHaveTextContent("не означает нулевое");
  expect(screen.queryByText("0")).not.toBeInTheDocument();
});
it("counts unique parameters separately from scopes and preserves every uncertainty", () => {
  const items = [
    finding("P001", "CANDIDATE", { has_evidence: true }),
    finding("P001", "NOT_COMPARABLE", { scope_key: "other" }),
    finding("P002", "NOT_APPLICABLE"),
    finding("P003", "MISSING_EVIDENCE", {
      gate_reasons: ["rule_not_approved"],
    }),
  ];
  const summary = parameterCoverage(items)!;
  expect(summary.observedParameters).toBe(3);
  expect(summary.controlPoints).toBe(4);
  expect(summary.statusCounts.NOT_COMPARABLE).toBe(1);
  expect(summary.statusCounts.NOT_APPLICABLE).toBe(1);
  expect(summary.unavailableRules).toBe(1);
  expect(items.filter(isReviewFinding)).toHaveLength(1);
  render(
    <ParameterCoverage
      protocol={{ ...protocol, parameters: 132, parameters_compared: 0 }}
      items={items}
      loading={false}
      error={false}
    />,
  );
  expect(
    screen.getByText("Все результаты по параметрам (3)"),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Полнота списка не подтверждена/),
  ).toBeInTheDocument();
  expect(screen.getByText(/Финализация не подтверждает/)).toBeInTheDocument();
});
it("does not group non-comparable results as not applicable", () => {
  const findings = [
    finding("P001", "NOT_COMPARABLE"),
    finding("P002", "NOT_APPLICABLE"),
  ].map((item, index) => toVerificationFinding(item, index));
  expect(
    filterFindingsByGroup(findings, FindingStatusGroup.NOT_COMPARABLE).map(
      (item) => item.parameterCode,
    ),
  ).toEqual(["P001"]);
  expect(
    filterFindingsByGroup(findings, FindingStatusGroup.NOT_APPLICABLE).map(
      (item) => item.parameterCode,
    ),
  ).toEqual(["P002"]);
});
