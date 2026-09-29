import { describe, expect, it } from "vitest";
import type { Evaluation } from "../completeness/completeness-contract.js";
import type {
  GroupMember,
  GroupVerdict,
  VerdictStatus,
} from "../extraction/comparison-engine.js";
import {
  buildProtocol,
  membersFingerprint,
  protocolContent,
  type BuilderGroup,
  type BuilderParameter,
} from "./protocol-builder.js";
import type { SectionFindingInput } from "./section-findings.js";
import {
  decisionTarget,
  REJECTION_REASON_CODES,
  statusForVerdict,
} from "./verification-contract.js";

function member(overrides: Partial<GroupMember>): GroupMember {
  return {
    extraction_id: "ex-1",
    file_id: "file-1",
    stage: null,
    role: "expected",
    status: "extracted",
    value: null,
    value_raw: null,
    unit: null,
    ...overrides,
  };
}

function verdict(
  status: VerdictStatus,
  overrides: Partial<GroupVerdict> = {},
): GroupVerdict {
  return {
    engine: "comparison-engine-v2",
    status,
    spec: { kind: "equals" },
    expected: null,
    actual: null,
    pairs: [],
    warnings: [],
    evaluated_at: "2026-09-21T00:00:00.000Z",
    ...overrides,
  };
}

function group(
  parameterCode: string,
  verdictStatus: VerdictStatus | null,
  members: GroupMember[] = [member({ status: "extracted" })],
): BuilderGroup {
  return {
    id: `group-${parameterCode}`,
    parameter_code: parameterCode,
    scope_key: "",
    ruleset_hash: "a".repeat(64),
    members,
    verdict: verdictStatus === null ? null : verdict(verdictStatus),
  };
}

function parameter(
  code: string,
  overrides: Partial<BuilderParameter> = {},
): BuilderParameter {
  return {
    parameter_code: code,
    criticality: null,
    relevant_stages: ["PD", "RD"],
    has_rule: true,
    applicable: true,
    ...overrides,
  };
}

function build(
  parameters: BuilderParameter[],
  groups: BuilderGroup[],
  evaluation: Evaluation | null = null,
) {
  return buildProtocol({
    parameters,
    groups,
    evaluation,
    fileSha256: new Map([["file-1", "sha-1"]]),
  });
}

describe("statusForVerdict", () => {
  it.each([
    ["discrepancy", "CANDIDATE"],
    ["match", "NEGATIVE_VERIFIED"],
    ["expected_missing", "MISSING_EVIDENCE"],
    ["actual_missing", "MISSING_EVIDENCE"],
    ["expected_ambiguous", "CLARIFICATION_REQUIRED"],
    ["actual_ambiguous", "CLARIFICATION_REQUIRED"],
    ["not_comparable", "NOT_COMPARABLE"],
    ["no_comparison", "NOT_COMPARABLE"],
  ] as const)("%s → %s", (verdict, status) => {
    expect(statusForVerdict(verdict)).toBe(status);
  });
});

describe("buildProtocol", () => {
  it("сохраняет два контекста одного параметра и считает покрытие отдельно", () => {
    const result = build(
      [parameter("P022")],
      [
        { ...group("P022", "match"), id: "jan", scope_key: "work-jan" },
        { ...group("P022", "discrepancy"), id: "feb", scope_key: "work-feb" },
      ],
    );
    expect(result.findings).toHaveLength(2);
    expect(
      result.findings.map((item) => item.evidence_group_id).sort(),
    ).toEqual(["feb", "jan"]);
    expect(protocolContent(result, null)).toMatchObject({
      findings_count: 2,
      parameters_count: 1,
    });
  });

  it("неустановленная применимость блокирует даже численно совпавший результат", () => {
    const item = group("P022", "match");
    item.verdict = verdict("match", {
      identity_blockers: ["approval_unknown"],
    });
    const result = build([parameter("P022")], [item]);
    expect(result.findings[0]?.status).toBe("CLARIFICATION_REQUIRED");
    expect(result.findings[0]?.gate_reasons).toContain("approval_unknown");
    const mixed = build(
      [parameter("P022")],
      [
        { ...group("P022", "match"), scope_key: "resolved" },
        { ...item, scope_key: "unresolved" },
      ],
    );
    expect(protocolContent(mixed, null)).toMatchObject({
      findings_count: 2,
      parameters_count: 1,
      parameters_compared: 0,
    });
  });
  it("discrepancy с gate READY даёт CANDIDATE", () => {
    const result = build(
      [parameter("P022")],
      [group("P022", "discrepancy")],
      null,
    );
    expect(result.findings[0]?.status).toBe("CANDIDATE");
    expect(result.findings[0]?.verdict?.status).toBe("discrepancy");
    expect(result.findings[0]?.evidence_group_id).toBe("group-P022");
  });

  it("match даёт авто-негатив NEGATIVE_VERIFIED", () => {
    const result = build([parameter("P009")], [group("P009", "match")], null);
    expect(result.findings[0]?.status).toBe("NEGATIVE_VERIFIED");
  });

  it.each(["expected_missing", "actual_missing"] as const)(
    "%s → MISSING_EVIDENCE без нарушения",
    (status) => {
      const result = build([parameter("P007")], [group("P007", status)], null);
      expect(result.findings[0]?.status).toBe("MISSING_EVIDENCE");
    },
  );

  it.each(["expected_ambiguous", "actual_ambiguous"] as const)(
    "%s → CLARIFICATION_REQUIRED",
    (status) => {
      const result = build([parameter("P002")], [group("P002", status)], null);
      expect(result.findings[0]?.status).toBe("CLARIFICATION_REQUIRED");
    },
  );

  it.each(["not_comparable", "no_comparison"] as const)(
    "%s → NOT_COMPARABLE",
    (status) => {
      const result = build([parameter("P015")], [group("P015", status)], null);
      expect(result.findings[0]?.status).toBe("NOT_COMPARABLE");
    },
  );

  it("параметр без группы → MISSING_EVIDENCE (evidence_absent)", () => {
    const result = build([parameter("P055")], [], null);
    expect(result.findings[0]?.status).toBe("MISSING_EVIDENCE");
    expect(result.findings[0]?.gate_reasons).toContain("evidence_absent");
  });

  it("параметр без утверждённого правила → MISSING_EVIDENCE (rule_not_approved)", () => {
    const result = build([parameter("P100", { has_rule: false })], [], null);
    expect(result.findings[0]?.status).toBe("MISSING_EVIDENCE");
    expect(result.findings[0]?.gate_reasons).toEqual(["rule_not_approved"]);
  });

  it("неприменимый параметр → NOT_APPLICABLE, вердикт не читается", () => {
    const result = build(
      [parameter("P002", { applicable: false })],
      [group("P002", "discrepancy")],
      null,
    );
    expect(result.findings[0]?.status).toBe("NOT_APPLICABLE");
    expect(result.findings[0]?.gate_reasons).toEqual([
      "parameter_not_applicable",
    ]);
  });

  it("недостающая стадия комплектности глушит discrepancy в MISSING_EVIDENCE", () => {
    const evaluation = {
      stages: {
        PD: {
          status: "UPLOADED",
          applicable: 1,
          fulfilled: 1,
          missing: 0,
          unverifiable: 0,
        },
        RD: {
          status: "PARTIAL",
          applicable: 2,
          fulfilled: 0,
          missing: 2,
          unverifiable: 0,
        },
        ID: null,
      },
      scenario: "PARTIALLY_LOADED",
      requirements: [],
      counts: {
        applicable: 3,
        fulfilled: 1,
        fulfilled_required: 1,
        missing: 2,
        unverifiable: 0,
        not_applicable: 0,
        reasons: {},
      },
    } satisfies Evaluation;
    const result = build(
      [parameter("P022")],
      [group("P022", "discrepancy")],
      evaluation,
    );
    expect(result.findings[0]?.status).toBe("MISSING_EVIDENCE");
    expect(result.findings[0]?.gate_reasons).toContain(
      "required_document_missing",
    );
  });

  it("неразрешённая стадия → CLARIFICATION_REQUIRED до вердикта", () => {
    const evaluation = {
      stages: {
        PD: {
          status: "PARTIAL",
          applicable: 1,
          fulfilled: 0,
          missing: 0,
          unverifiable: 1,
        },
        RD: null,
        ID: null,
      },
      scenario: "PARTIALLY_LOADED",
      requirements: [],
      counts: {
        applicable: 1,
        fulfilled: 0,
        fulfilled_required: 0,
        missing: 0,
        unverifiable: 1,
        not_applicable: 0,
        reasons: {},
      },
    } satisfies Evaluation;
    const result = build(
      [parameter("P022")],
      [group("P022", "discrepancy")],
      evaluation,
    );
    expect(result.findings[0]?.status).toBe("CLARIFICATION_REQUIRED");
    expect(result.findings[0]?.gate_reasons).toContain("stage_unresolved");
  });
});

function section(
  overrides: Partial<SectionFindingInput> = {},
): SectionFindingInput {
  return {
    parameter_code: "P1",
    context_id: "ctx-a",
    assessment: "potential_difference",
    fact: "В ИД указана марка B25 вместо B30 по ПД.",
    question_for_inspector: "Подтвердите фактическую марку.",
    missing_context: [],
    evidence: [
      {
        source_ref: "reference:1",
        role: "reference",
        section_id: "sec-1",
        document_id: "doc-pd",
        revision_id: "rev-pd",
        file_id: "file-1",
        artifact_id: "art-pd",
        page_number: 4,
        sheet_label: null,
        block_id: "b-12",
        table_id: null,
        table_row: null,
        table_column: null,
        quote: "Бетон В30",
        bbox: null,
        structural_path: null,
      },
      {
        source_ref: "actual:1",
        role: "actual",
        section_id: "sec-2",
        document_id: "doc-id",
        revision_id: "rev-id",
        file_id: "file-1",
        artifact_id: "art-id",
        page_number: 10,
        sheet_label: null,
        block_id: "b-21",
        table_id: null,
        table_row: null,
        table_column: null,
        quote: "Бетон В25",
        bbox: null,
        structural_path: null,
      },
    ],
    coverage: { complete: true, missing: [] },
    context: {
      context_id: "ctx-a",
      scope: "object",
      works_period: { from: null, to: null },
      reference: { document_id: "doc-pd", revision_id: "rev-pd" },
      actual: { document_id: "doc-id", revision_id: "rev-id" },
    },
    sources: [
      {
        source_ref: "reference:1",
        role: "reference",
        document_id: "doc-pd",
        revision_id: "rev-pd",
        document_stage: "PD",
        file_id: "file-1",
        artifact_id: "art-pd",
        artifact_sha256: "sha-pd",
        source_sha256: "s-pd",
        selection_hash: null,
        pages: [4],
      },
      {
        source_ref: "actual:1",
        role: "actual",
        document_id: "doc-id",
        revision_id: "rev-id",
        document_stage: "ID",
        file_id: "file-1",
        artifact_id: "art-id",
        artifact_sha256: "sha-id",
        source_sha256: "s-id",
        selection_hash: null,
        pages: [10],
      },
    ],
    sections: [
      {
        section_id: "sec-1",
        source_ref: "reference:1",
        title: "Материалы",
        start_block_id: "b-10",
        end_block_id: "b-14",
        parameter_codes: ["P1"],
      },
      {
        section_id: "sec-2",
        source_ref: "actual:1",
        title: "Ведомость",
        start_block_id: "b-20",
        end_block_id: "b-22",
        parameter_codes: ["P1"],
      },
    ],
    matrix: {
      parameter_code: "P1",
      name: "Марка бетона",
      unit: "класс",
      source_pd: "ПД п.4",
      source_rd: null,
      source_id: "ИД ведомость",
      trigger: "все",
    },
    analysis_basis: {
      matrix_identity: "matrix-abc",
      model: "test-model",
      discovery_prompt_version: "d1",
      analysis_prompt_version: "a1",
    },
    task_fingerprint: "task-fp-1",
    result_fingerprint: "result-fp-1",
    ...overrides,
  };
}

describe("buildProtocol + sectionResults", () => {
  it("VR5: READY section-only контекст без regex-правила даёт CANDIDATE", () => {
    const result = buildProtocol({
      parameters: [parameter("P1", { has_rule: false })],
      groups: [],
      evaluation: null,
      fileSha256: new Map([["file-1", "sha-1"]]),
      unresolvedSources: ["comparison_context_unresolved"],
      contextBlockers: new Map([["ctx-a", []]]),
      sectionResults: [section()],
    });
    expect(result.findings).toHaveLength(1);
    const finding = result.findings[0]!;
    expect(finding.status).toBe("CANDIDATE");
    expect(finding.scope_key).toBe("ctx-a");
    // Готовый контекст не наследует общий comparison_context_unresolved.
    expect(finding.gate_reasons).not.toContain("comparison_context_unresolved");
    expect(finding.gate_reasons).not.toContain("rule_not_approved");
    // Нет сфабрикованных Extraction/RuleVersion ссылок.
    expect(finding.evidence_group_id).toBeNull();
    expect(finding.verdict).toBeNull();
    expect(finding.evidence_snapshot.section_analysis?.assessment).toBe(
      "potential_difference",
    );
    expect(finding.evidence_snapshot.section_analysis?.task_fingerprint).toBe(
      "task-fp-1",
    );
  });

  it("VR5: заблокированный контекст сохраняет собственные причины", () => {
    const result = buildProtocol({
      parameters: [parameter("P1", { has_rule: false })],
      groups: [],
      evaluation: null,
      fileSha256: new Map([["file-1", "sha-1"]]),
      unresolvedSources: ["comparison_context_unresolved"],
      contextBlockers: new Map([["ctx-a", ["reference_revision_ambiguous"]]]),
      sectionResults: [section()],
    });
    const finding = result.findings[0]!;
    expect(finding.status).toBe("CLARIFICATION_REQUIRED");
    expect(finding.gate_reasons).toContain("reference_revision_ambiguous");
  });

  it("завершённый детерминированный вердикт сохраняет статус, разделы — advisory", () => {
    const withMatch = buildProtocol({
      parameters: [parameter("P1")],
      groups: [{ ...group("P1", "match"), scope_key: "ctx-a" }],
      evaluation: null,
      fileSha256: new Map([["file-1", "sha-1"]]),
      contextBlockers: new Map([["ctx-a", []]]),
      sectionResults: [section()],
    });
    expect(withMatch.findings[0]!.status).toBe("NEGATIVE_VERIFIED");
    expect(
      withMatch.findings[0]!.evidence_snapshot.section_analysis?.fact,
    ).toBe("В ИД указана марка B25 вместо B30 по ПД.");
    const withDiscrepancy = buildProtocol({
      parameters: [parameter("P1")],
      groups: [{ ...group("P1", "discrepancy"), scope_key: "ctx-a" }],
      evaluation: null,
      fileSha256: new Map([["file-1", "sha-1"]]),
      contextBlockers: new Map([["ctx-a", []]]),
      sectionResults: [section()],
    });
    expect(withDiscrepancy.findings[0]!.status).toBe("CANDIDATE");
    expect(withDiscrepancy.findings[0]!.verdict?.status).toBe("discrepancy");
  });

  it("неполный факт раздела даёт NOT_COMPARABLE с конкретными причинами", () => {
    const result = buildProtocol({
      parameters: [parameter("P1", { has_rule: false })],
      groups: [],
      evaluation: null,
      fileSha256: new Map([["file-1", "sha-1"]]),
      contextBlockers: new Map([["ctx-a", []]]),
      sectionResults: [
        section({
          assessment: "insufficient_context",
          fact: null,
          missing_context: ["В ИД нет раздела с маркой"],
        }),
      ],
    });
    const finding = result.findings[0]!;
    expect(finding.status).toBe("NOT_COMPARABLE");
    expect(finding.gate_reasons).toContain("section_context_incomplete");
  });

  it("CR18: неполный агрегат не стирает покрытый ряд — P1 кандидат, P2 нет", () => {
    const result = buildProtocol({
      parameters: [
        parameter("P1", { has_rule: false }),
        parameter("P2", { has_rule: false }),
      ],
      groups: [],
      evaluation: null,
      fileSha256: new Map([["file-1", "sha-1"]]),
      contextBlockers: new Map([["ctx-a", []]]),
      sectionResults: [
        section(), // effective coverage complete (parameter.coverage)
        section({
          parameter_code: "P2",
          assessment: "insufficient_context",
          fact: null,
          evidence: [],
          missing_context: ["В ИД нет раздела с отметками"],
          coverage: {
            complete: false,
            missing: ["row_unanswered:P2"],
          },
        }),
      ],
    });
    const p1 = result.findings.find((f) => f.parameter_code === "P1")!;
    const p2 = result.findings.find((f) => f.parameter_code === "P2")!;
    expect(p1.status).toBe("CANDIDATE");
    // P2 has no section coverage of its own: it can never become a
    // candidate, and its own incomplete coverage is what gets frozen.
    expect(p2.status).not.toBe("CANDIDATE");
    expect(p2.evidence_snapshot.section_analysis?.coverage).toEqual({
      complete: false,
      missing: ["row_unanswered:P2"],
    });
    expect(p1.evidence_snapshot.section_analysis?.coverage).toEqual({
      complete: true,
      missing: [],
    });
  });

  it("members_fingerprint включает базис задачи и результата", () => {
    const options = {
      parameters: [parameter("P1", { has_rule: false })],
      groups: [] as BuilderGroup[],
      evaluation: null,
      fileSha256: new Map([["file-1", "sha-1"]]),
      contextBlockers: new Map([["ctx-a", []]]),
    };
    const first = buildProtocol({
      ...options,
      sectionResults: [section()],
    }).findings[0]!.members_fingerprint;
    const otherTask = buildProtocol({
      ...options,
      sectionResults: [section({ task_fingerprint: "task-fp-2" })],
    }).findings[0]!.members_fingerprint;
    const otherResult = buildProtocol({
      ...options,
      sectionResults: [section({ result_fingerprint: "result-fp-2" })],
    }).findings[0]!.members_fingerprint;
    expect(otherTask).not.toBe(first);
    expect(otherResult).not.toBe(first);
  });

  it("protocolContent фиксирует базис даже без section findings", () => {
    const built = buildProtocol({
      parameters: [parameter("P1")],
      groups: [group("P1", "match")],
      evaluation: null,
      fileSha256: new Map([["file-1", "sha-1"]]),
      sectionResults: [],
    });
    const basis = { task_fingerprint: "t", result_fingerprint: "r" };
    expect(protocolContent(built, null, basis).section_analysis).toEqual(basis);
    // Базис фиксируется и при нулевом покрытии — идемпотентность протокола.
    const empty = buildProtocol({
      parameters: [parameter("P1")],
      groups: [group("P1", "match")],
      evaluation: null,
      fileSha256: new Map([["file-1", "sha-1"]]),
      sectionResults: [],
    });
    expect(
      protocolContent(empty, null, basis).parameters_with_section_analysis,
    ).toBe(0);
    expect(protocolContent(built, null, null).section_analysis).toBeNull();
  });
});

describe("membersFingerprint", () => {
  it("unrelated release changes preserve a per-rule semantic fingerprint", () => {
    const first = {
      ...group("P002", "match"),
      ruleset_hash: "release-A",
      rule_fingerprint: "same-rule-and-basis",
    };
    const second = { ...first, ruleset_hash: "release-B" };
    const fingerprint = (g: BuilderGroup) =>
      build([parameter("P002")], [g]).findings[0]!.members_fingerprint;
    expect(fingerprint(first)).toBe(fingerprint(second));
    expect(fingerprint({ ...second, rule_fingerprint: "new-basis" })).not.toBe(
      fingerprint(first),
    );
  });
  it("одно значение не переносит решение при смене редакции, правила, области или цитаты", () => {
    const baseMember = member({
      value: 100,
      revision_id: "r1",
      rule_version_id: "rule1",
      evidence: [{ quote: "100 м2", pageNumber: 1 }],
    });
    const original = membersFingerprint(
      [baseMember],
      verdict("match", { context: { scope: "A" } }),
      new Map(),
    );
    for (const changed of [
      { ...baseMember, revision_id: "r2" },
      { ...baseMember, rule_version_id: "rule2" },
      { ...baseMember, evidence: [{ quote: "100 м2", pageNumber: 2 }] },
    ]) {
      expect(
        membersFingerprint(
          [changed],
          verdict("match", { context: { scope: "A" } }),
          new Map(),
        ),
      ).not.toBe(original);
    }
    expect(
      membersFingerprint(
        [baseMember],
        verdict("match", { context: { scope: "B" } }),
        new Map(),
      ),
    ).not.toBe(original);
  });
  const members = [
    member({ role: "expected", value: 100, unit: "m2" }),
    member({ role: "actual", value: 100, unit: "m2" }),
  ];

  it("стабилен при смене extraction_id/file_id с тем же содержимым", () => {
    const sha = new Map([
      ["file-1", "sha-A"],
      ["file-9", "sha-A"],
    ]);
    const first = membersFingerprint(members, verdict("match"), sha);
    const renamed = members.map((item) => ({
      ...item,
      extraction_id: "ex-new",
      file_id: "file-9",
    }));
    const second = membersFingerprint(renamed, verdict("match"), sha);
    expect(second).toBe(first);
  });

  it("меняется при смене значения, контента файла или спеки", () => {
    const sha = new Map([["file-1", "sha-A"]]);
    const base = membersFingerprint(members, verdict("match"), sha);
    const changedValue = members.map((item) =>
      item.role === "actual" ? { ...item, value: 200 } : item,
    );
    expect(
      membersFingerprint(changedValue, verdict("discrepancy"), sha),
    ).not.toBe(base);
    const otherSha = new Map([["file-1", "sha-B"]]);
    expect(membersFingerprint(members, verdict("match"), otherSha)).not.toBe(
      base,
    );
    const otherSpec = verdict("match", {
      spec: { kind: "numeric_delta", tolerance_abs: 1 },
    });
    expect(membersFingerprint(members, otherSpec, sha)).not.toBe(base);
  });
});

describe("decisionTarget", () => {
  it("допустимые переходы по таблице D6", () => {
    expect(decisionTarget("confirm", "CANDIDATE")).toBe("CONFIRMED_VIOLATION");
    expect(decisionTarget("reject", "CANDIDATE")).toBe("NEGATIVE_VERIFIED");
    expect(decisionTarget("clarify", "CANDIDATE")).toBe(
      "CLARIFICATION_REQUIRED",
    );
    expect(decisionTarget("reopen", "CLARIFICATION_REQUIRED")).toBe(
      "CANDIDATE",
    );
    expect(decisionTarget("reopen", "CONFIRMED_VIOLATION")).toBe("CANDIDATE");
    expect(decisionTarget("reopen", "NEGATIVE_VERIFIED")).toBe("CANDIDATE");
  });

  it("отклоняет недопустимые переходы и служебные статусы", () => {
    expect(decisionTarget("confirm", "CONFIRMED_VIOLATION")).toBeNull();
    expect(decisionTarget("reject", "NEGATIVE_VERIFIED")).toBeNull();
    expect(decisionTarget("confirm", "MISSING_EVIDENCE")).toBeNull();
    expect(decisionTarget("reject", "NOT_COMPARABLE")).toBeNull();
    expect(decisionTarget("clarify", "NOT_APPLICABLE")).toBeNull();
    expect(decisionTarget("reopen", "CANDIDATE")).toBeNull();
  });

  it("справочник причин отклонения покрывает варианты мока", () => {
    expect(REJECTION_REASON_CODES).toEqual([
      "wrong_revision",
      "approved_change",
      "ocr_error",
      "evidence_binding_error",
      "not_applicable",
      "no_discrepancy",
    ]);
  });
});
