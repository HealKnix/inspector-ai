// Pure protocol assembly (design D4–D5): matrix parameters × evidence
// groups × completeness gate → findings with a stable evidence fingerprint.
// No I/O — the service feeds rows in and persists the result.

import { createHash } from "node:crypto";

import type {
  Evaluation,
  Stage,
} from "../completeness/completeness-contract.js";
import { parameterGate } from "../completeness/completeness-engine.js";
import type {
  GroupMember,
  GroupVerdict,
} from "../extraction/comparison-engine.js";
import {
  statusForGate,
  statusForVerdict,
  VERIFICATION_SCHEMA_VERSION,
  type FindingStatusValue,
} from "./verification-contract.js";

export interface BuilderGroup {
  id: string;
  parameter_code: string;
  scope_key: string;
  ruleset_hash: string;
  members: unknown;
  verdict: unknown;
}

export interface BuilderParameter {
  parameter_code: string;
  criticality: string | null;
  /** Стадии, из которых параметр ждёт источники (source_pd/rd/id матрицы). */
  relevant_stages: Stage[];
  /** Есть ли утверждённая версия правила с применимым условием. */
  has_rule: boolean;
  /** rule_versions.applicability против атрибутов объекта (уже вычислено). */
  applicable: boolean;
}

export interface BuiltFinding {
  parameter_code: string;
  scope_key: string;
  status: FindingStatusValue;
  risk: string | null;
  evidence_group_id: string | null;
  verdict: GroupVerdict | null;
  gate_reasons: string[];
  members_fingerprint: string;
}

export interface BuildInput {
  parameters: BuilderParameter[];
  groups: BuilderGroup[];
  /** Последняя оценка комплектности; null — gate работает по evidence. */
  evaluation: Evaluation | null;
  /** file_id → sha256 для семантического отпечатка членов группы. */
  fileSha256: Map<string, string>;
}

export interface BuildResult {
  findings: BuiltFinding[];
  findings_hash: string;
  scenario: Evaluation["scenario"] | null;
}

function isVerdict(value: unknown): value is GroupVerdict {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as GroupVerdict).status === "string"
  );
}

function isMembers(value: unknown): value is GroupMember[] {
  return Array.isArray(value);
}

/**
 * Semantic fingerprint of what the inspector saw: member role/status/value/
 * unit plus the file *content* hash (file_id and extraction_id change every
 * cycle and must not reset decisions), plus the verdict status and spec —
 * a changed comparison spec is a changed judgement basis.
 */
export function membersFingerprint(
  members: GroupMember[],
  verdict: GroupVerdict | null,
  fileSha256: Map<string, string>,
): string {
  const hash = createHash("sha256");
  const normalized = members
    .map((member) =>
      [
        member.role,
        member.status,
        String(member.value ?? ""),
        member.value_raw ?? "",
        member.unit ?? "",
        fileSha256.get(member.file_id) ?? member.file_id,
      ].join("|"),
    )
    .sort();
  for (const row of normalized) hash.update(row).update("\n");
  hash.update(JSON.stringify(verdict?.status ?? null));
  hash.update(JSON.stringify(verdict?.spec ?? null));
  return hash.digest("hex");
}

function hasEvidence(members: GroupMember[]): boolean {
  return members.some((member) => member.status === "extracted");
}

export function buildProtocol(input: BuildInput): BuildResult {
  const groups = new Map<string, BuilderGroup>();
  for (const group of input.groups) {
    groups.set(`${group.parameter_code}${group.scope_key}`, group);
  }
  const findings: BuiltFinding[] = [];
  for (const parameter of input.parameters) {
    const group = groups.get(`${parameter.parameter_code}`);
    const members = group && isMembers(group.members) ? group.members : [];
    const verdict = group && isVerdict(group.verdict) ? group.verdict : null;

    let status: FindingStatusValue;
    let reasons: string[];
    if (!parameter.has_rule) {
      // Параметр в матрице есть, но утверждённого правила нет — проверка
      // не выполнялась, это недостаток возможности, а не нарушение.
      status = "MISSING_EVIDENCE";
      reasons = ["rule_not_approved"];
    } else if (!parameter.applicable) {
      status = "NOT_APPLICABLE";
      reasons = ["parameter_not_applicable"];
    } else {
      const gate = parameterGate({
        parameterApplicable: true,
        relevantStages: parameter.relevant_stages,
        stages: input.evaluation?.stages ?? { PD: null, RD: null, ID: null },
        evidencePresent: hasEvidence(members),
        revisionUnresolved: false,
      });
      const gated = statusForGate(gate.gate);
      status = gated ?? statusForVerdict(verdict?.status ?? "no_comparison");
      reasons = gate.reasons;
    }
    findings.push({
      parameter_code: parameter.parameter_code,
      scope_key: group?.scope_key ?? "",
      status,
      risk: parameter.criticality,
      evidence_group_id: group?.id ?? null,
      verdict,
      gate_reasons: reasons,
      members_fingerprint: membersFingerprint(
        members,
        verdict,
        input.fileSha256,
      ),
    });
  }
  findings.sort((a, b) =>
    `${a.parameter_code}|${a.scope_key}`.localeCompare(
      `${b.parameter_code}|${b.scope_key}`,
    ),
  );
  const hash = createHash("sha256");
  for (const finding of findings) {
    hash
      .update(finding.parameter_code)
      .update("|")
      .update(finding.scope_key)
      .update("|")
      .update(finding.status)
      .update("|")
      .update(finding.members_fingerprint)
      .update("\n");
  }
  return {
    findings,
    findings_hash: hash.digest("hex"),
    scenario: input.evaluation?.scenario ?? null,
  };
}

export function protocolContent(
  result: BuildResult,
  completenessResultId: string | null,
) {
  const counts: Record<string, number> = {};
  for (const finding of result.findings) {
    counts[finding.status] = (counts[finding.status] ?? 0) + 1;
  }
  return {
    schema_version: VERIFICATION_SCHEMA_VERSION,
    scenario: result.scenario,
    completeness_result_id: completenessResultId,
    counts,
    findings: result.findings.map((finding) => ({
      parameter_code: finding.parameter_code,
      scope_key: finding.scope_key,
      status: finding.status,
      risk: finding.risk,
      expected: finding.verdict?.expected ?? null,
      actual: finding.verdict?.actual ?? null,
      verdict_status: finding.verdict?.status ?? null,
      gate_reasons: finding.gate_reasons,
    })),
  };
}
