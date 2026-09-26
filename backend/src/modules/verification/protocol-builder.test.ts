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

describe("membersFingerprint", () => {
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
    ]);
  });
});
