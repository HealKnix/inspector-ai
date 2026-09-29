// Pure protocol assembly (design D4–D5): matrix parameters × evidence
// groups × completeness gate → findings with a stable evidence fingerprint.
// No I/O — the service feeds rows in and persists the result.

import { createHash } from "node:crypto";
import { canonicalJson } from "../documents/canonical-json.js";
import { compositeSemanticBasis } from "../extraction/composite-comparison.js";

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
  sectionFingerprint,
  sectionHasEvidence,
  sectionResultStatus,
  toSectionSnapshot,
  type SectionAnalysisSnapshot,
  type SectionFindingInput,
  type SectionProtocolBasis,
} from "./section-findings.js";
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
  rule_fingerprint?: string;
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
  evidence_snapshot: {
    schema_version: 1;
    members: GroupMember[];
    context: unknown;
    selection_basis: unknown;
    section_analysis: SectionAnalysisSnapshot | null;
  };
}

export interface BuildInput {
  parameters: BuilderParameter[];
  groups: BuilderGroup[];
  /** Последняя оценка комплектности; null — gate работает по evidence. */
  evaluation: Evaluation | null;
  /** file_id → sha256 для семантического отпечатка членов группы. */
  fileSha256: Map<string, string>;
  unresolvedSources?: string[];
  /**
   * Блокеры идентификации по контексту сравнения из допущенного снимка.
   * Находка без скалярной группы наследует блокеры своего контекста, а не
   * глобальный fallback: READY-контекст даёт пустой список (VR5).
   */
  contextBlockers?: ReadonlyMap<string, readonly string[]>;
  /**
   * Опубликованные результаты анализа разделов текущей выборки (D7). Каждая
   * запись привязана к реальной строке матрицы и контексту сравнения;
   * Extraction/RuleVersion идентификаторы здесь не появляются никогда.
   */
  sectionResults?: SectionFindingInput[];
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
  rulesetHash = "",
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
        member.document_id ?? "",
        member.revision_id ?? "",
        member.rule_version_id ?? "",
        canonicalJson(member.numerical ?? null),
        member.artifact_sha256 ?? "",
        canonicalJson(
          (member.evidence ?? []).map((item) =>
            Object.fromEntries(
              Object.entries(item as Record<string, unknown>).filter(
                ([key]) =>
                  !["extractionId", "artifactId", "fileId", "id"].includes(key),
              ),
            ),
          ),
        ),
      ].join("|"),
    )
    .sort();
  for (const row of normalized) hash.update(row).update("\n");
  hash.update(JSON.stringify(verdict?.status ?? null));
  hash.update(JSON.stringify(verdict?.spec ?? null));
  hash.update(rulesetHash);
  // Sheet provenance contains per-Run PAR record IDs. Cache reuse preserves
  // content/locators/decisions and must not invalidate an unchanged decision.
  const semanticContext =
    verdict?.context === undefined ? null : structuredClone(verdict.context);
  if (
    semanticContext &&
    typeof semanticContext === "object" &&
    "sheet_selection" in semanticContext
  ) {
    const selections = semanticContext.sheet_selection;
    if (selections && typeof selections === "object") {
      for (const selection of Object.values(
        selections as Record<string, unknown>,
      )) {
        if (
          selection &&
          typeof selection === "object" &&
          "sheets" in selection &&
          Array.isArray(selection.sheets)
        ) {
          for (const sheet of selection.sheets as unknown[])
            if (sheet && typeof sheet === "object" && "artifact_id" in sheet)
              delete sheet.artifact_id;
        }
      }
    }
  }
  hash.update(canonicalJson(semanticContext));
  hash.update(canonicalJson(verdict?.selection_basis ?? null));
  if (verdict?.rule_basis) hash.update(canonicalJson(verdict.rule_basis));
  if (verdict?.composite) {
    hash.update(canonicalJson(compositeSemanticBasis(verdict.composite)));
    hash.update(
      canonicalJson(
        members
          .map((member) => member.comparison_context ?? null)
          .sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b))),
      ),
    );
  }
  return hash.digest("hex");
}

function hasEvidence(members: GroupMember[]): boolean {
  return members.some((member) => member.status === "extracted");
}

/**
 * Вердикт детерминированного пути, который сам несёт результат сравнения.
 * Отсутствие результата (нет значения, «несопоставимо», «не сравнивалось»)
 * не блокирует полный подтверждённый факт анализа разделов.
 */
const CONCLUSIVE_VERDICTS = new Set([
  "match",
  "discrepancy",
  "expected_ambiguous",
  "actual_ambiguous",
]);

export function buildProtocol(input: BuildInput): BuildResult {
  const groups = new Map<string, BuilderGroup[]>();
  for (const group of input.groups) {
    groups.set(group.parameter_code, [
      ...(groups.get(group.parameter_code) ?? []),
      group,
    ]);
  }
  const sectionByScope = new Map<string, SectionFindingInput>();
  const sectionScopes = new Map<string, Set<string>>();
  for (const section of input.sectionResults ?? []) {
    sectionByScope.set(
      `${section.parameter_code}\n${section.context_id}`,
      section,
    );
    const scopes = sectionScopes.get(section.parameter_code) ?? new Set();
    scopes.add(section.context_id);
    sectionScopes.set(section.parameter_code, scopes);
  }
  const findings: BuiltFinding[] = [];
  for (const parameter of input.parameters) {
    const parameterGroups = groups.get(parameter.parameter_code) ?? [];
    const scopes: { group: BuilderGroup | undefined; scope: string }[] =
      parameterGroups.map((group) => ({ group, scope: group.scope_key }));
    for (const scope of sectionScopes.get(parameter.parameter_code) ?? [])
      if (!scopes.some((entry) => entry.scope === scope))
        scopes.push({ group: undefined, scope });
    if (scopes.length === 0) scopes.push({ group: undefined, scope: "" });
    for (const { group, scope } of scopes) {
      const section = sectionByScope.get(
        `${parameter.parameter_code}\n${scope}`,
      );
      const members = group && isMembers(group.members) ? group.members : [];
      const verdict = group && isVerdict(group.verdict) ? group.verdict : null;
      const identityBlockers =
        verdict?.identity_blockers ??
        (!group
          ? ([
              ...(input.contextBlockers?.get(scope) ??
                input.unresolvedSources ??
                []),
            ] as string[])
          : []);

      let status: FindingStatusValue;
      let reasons: string[];
      if (!parameter.has_rule && !section) {
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
          evidencePresent:
            hasEvidence(members) ||
            (section !== undefined && sectionHasEvidence(section)),
          revisionUnresolved: identityBlockers.length > 0,
        });
        const gated = statusForGate(gate.gate);
        if (gated) {
          status = gated;
          reasons = [...gate.reasons, ...identityBlockers];
        } else if (
          verdict !== null &&
          CONCLUSIVE_VERDICTS.has(verdict.status)
        ) {
          // Завершённый детерминированный ответ сохраняет статус; факты
          // анализа разделов прилагаются только как совещательные.
          status = statusForVerdict(verdict.status);
          reasons = [...gate.reasons, ...identityBlockers];
        } else if (
          section &&
          sectionResultStatus(section).status === "CANDIDATE"
        ) {
          // Полный подтверждённый факт разделов — предварительный, решение
          // за инспектором; отсутствие regex-результата его не подавляет.
          status = "CANDIDATE";
          reasons = [...gate.reasons, ...identityBlockers];
        } else {
          status = statusForVerdict(verdict?.status ?? "no_comparison");
          reasons = [
            ...gate.reasons,
            ...identityBlockers,
            ...(section ? sectionResultStatus(section).reasons : []),
          ];
        }
      }
      const memberFingerprint = membersFingerprint(
        members,
        verdict,
        input.fileSha256,
        group?.rule_fingerprint ?? group?.ruleset_hash,
      );
      findings.push({
        parameter_code: parameter.parameter_code,
        scope_key: scope,
        status,
        risk: parameter.criticality,
        evidence_group_id: group?.id ?? null,
        verdict,
        gate_reasons: reasons,
        members_fingerprint: section
          ? createHash("sha256")
              .update(memberFingerprint)
              .update("\n")
              .update(sectionFingerprint(section, input.fileSha256))
              .digest("hex")
          : memberFingerprint,
        evidence_snapshot: {
          schema_version: 1,
          members,
          context: verdict?.context ?? null,
          selection_basis: verdict?.selection_basis ?? null,
          section_analysis: section ? toSectionSnapshot(section) : null,
        },
      });
    }
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
  /** Basis of the admitted section task/result frozen into this protocol. */
  sectionBasis: SectionProtocolBasis | null = null,
) {
  const counts: Record<string, number> = {};
  for (const finding of result.findings) {
    counts[finding.status] = (counts[finding.status] ?? 0) + 1;
  }
  const parameterCodes = [
    ...new Set(result.findings.map((finding) => finding.parameter_code)),
  ];
  const comparedStatuses = ["CANDIDATE", "NEGATIVE_VERIFIED"];
  const findingHasEvidence = (finding: BuiltFinding) =>
    hasEvidence(finding.evidence_snapshot.members) ||
    (finding.evidence_snapshot.section_analysis?.evidence.length ?? 0) > 0;
  return {
    schema_version: VERIFICATION_SCHEMA_VERSION,
    scenario: result.scenario,
    completeness_result_id: completenessResultId,
    section_analysis: sectionBasis,
    counts,
    findings_count: result.findings.length,
    parameters_count: new Set(
      result.findings.map((finding) => finding.parameter_code),
    ).size,
    parameters_with_evidence: new Set(
      result.findings
        .filter(findingHasEvidence)
        .map((finding) => finding.parameter_code),
    ).size,
    parameters_with_section_analysis: new Set(
      result.findings
        .filter(
          (finding) => finding.evidence_snapshot.section_analysis !== null,
        )
        .map((finding) => finding.parameter_code),
    ).size,
    parameters_compared: parameterCodes.filter((code) => {
      const contexts = result.findings.filter(
        (finding) => finding.parameter_code === code,
      );
      return (
        contexts.some((finding) => comparedStatuses.includes(finding.status)) &&
        contexts.every(
          (finding) =>
            comparedStatuses.includes(finding.status) ||
            finding.status === "NOT_APPLICABLE",
        )
      );
    }).length,
    findings: result.findings.map((finding) => ({
      parameter_code: finding.parameter_code,
      scope_key: finding.scope_key,
      status: finding.status,
      risk: finding.risk,
      expected: finding.verdict?.expected ?? null,
      actual: finding.verdict?.actual ?? null,
      verdict_status: finding.verdict?.status ?? null,
      section_assessment:
        finding.evidence_snapshot.section_analysis?.assessment ?? null,
      gate_reasons: finding.gate_reasons,
    })),
  };
}
