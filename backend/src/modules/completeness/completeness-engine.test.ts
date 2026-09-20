import { describe, expect, it } from "vitest";
import type {
  DocumentFact,
  ExpectedRequirement,
} from "./completeness-contract.js";
import { evaluate, parameterGate } from "./completeness-engine.js";

let seq = 0;
function req(partial: Partial<ExpectedRequirement>): ExpectedRequirement {
  seq += 1;
  return {
    id: `req-${seq}`,
    code: `R-${seq}`,
    stage: "PD",
    kind_code: "ПЗ",
    title: "Требование",
    scope: null,
    quantity: { min: 1, per: null },
    alternatives: null,
    excluded: false,
    ...partial,
  };
}

function doc(partial: Partial<DocumentFact>): DocumentFact {
  seq += 1;
  return {
    file_id: `file-${seq}`,
    sha256: `sha-${seq}`,
    stage: "PD",
    kind_code: "ПЗ",
    kind_ambiguous: false,
    needs_review: false,
    ...partial,
  };
}

describe("completeness engine", () => {
  it("закрывает OR-альтернативу любым допустимым видом", () => {
    const requirement = req({
      kind_code: "MAT_PASSPORT",
      stage: "ID",
      alternatives: { any: ["MAT_CERT", "MAT_DECL"] },
    });
    const result = evaluate(
      [requirement],
      [doc({ stage: "ID", kind_code: "MAT_CERT" })],
    );
    expect(result.requirements[0]!.outcome).toBe("fulfilled");
  });

  it("AND-сочетание требует каждого вида отдельно", () => {
    const requirements = [
      req({ stage: "ID", kind_code: "AOSR" }),
      req({ stage: "ID", kind_code: "NET_SCHEME" }),
    ];
    const result = evaluate(requirements, [
      doc({ stage: "ID", kind_code: "AOSR" }),
    ]);
    expect(result.requirements.map((r) => r.outcome)).toEqual([
      "fulfilled",
      "missing",
    ]);
    expect(result.counts.missing).toBe(1);
  });

  it("два представления одного документа не закрывают два экземпляра", () => {
    const requirements = [req({ quantity: { min: 2, per: null } })];
    const result = evaluate(requirements, [
      doc({ sha256: "same-binary" }),
      doc({ sha256: "same-binary" }),
    ]);
    expect(result.requirements[0]!.outcome).toBe("missing");
    expect(result.requirements[0]!.matched).toHaveLength(1);
    expect(result.requirements[0]!.missing_parts[0]).toContain("не хватает 1");
  });

  it("требование с областью не исполняется и не считается отсутствующим без разрешённой области документа", () => {
    const requirements = [
      req({
        stage: "ID",
        kind_code: "AOSR",
        scope: { item: "буросекущие сваи" },
        quantity: { min: 1, per: "hidden_works" },
      }),
    ];
    const result = evaluate(requirements, [
      doc({ stage: "ID", kind_code: "AOSR" }),
    ]);
    expect(result.requirements[0]!.outcome).toBe("unverifiable");
    expect(result.requirements[0]!.reasons).toContain("scope_unresolved");
  });

  it("неразрешённый документ стадии делает требование unverifiable, а не missing", () => {
    const requirements = [req({ stage: "ID", kind_code: "JOURNAL" })];
    const result = evaluate(requirements, [
      doc({ stage: "ID", kind_code: null }),
    ]);
    expect(result.requirements[0]!.outcome).toBe("unverifiable");
    expect(result.requirements[0]!.reasons).toContain("kind_unresolved");
  });

  it("исключённое инспектором требование не входит в применимый состав", () => {
    const requirements = [req({ excluded: true }), req({})];
    const result = evaluate(requirements, [doc({})]);
    expect(result.requirements[0]!.outcome).toBe("not_applicable");
    expect(result.counts.applicable).toBe(1);
    expect(result.counts.fulfilled).toBe(1);
  });

  it("полная ПД и РД при отсутствии ИД даёт PD_RD_ONLY и ID_MISSING", () => {
    const requirements = [
      req({ stage: "PD", kind_code: "ПЗ" }),
      req({ stage: "RD", kind_code: "ОД" }),
      req({ stage: "ID", kind_code: "JOURNAL" }),
    ];
    const result = evaluate(requirements, [
      doc({ stage: "PD", kind_code: "ПЗ" }),
      doc({ stage: "RD", kind_code: "ОД" }),
    ]);
    expect(result.stages.PD?.status).toBe("UPLOADED");
    expect(result.stages.RD?.status).toBe("UPLOADED");
    expect(result.stages.ID?.status).toBe("MISSING");
    expect(result.scenario).toBe("PD_RD_ONLY");
  });

  it("наличие файлов трёх стадий не даёт FULL при незакрытых требованиях", () => {
    const requirements = [
      req({ stage: "PD", kind_code: "ПЗ" }),
      req({ stage: "PD", kind_code: "КР" }),
      req({ stage: "RD", kind_code: "ОД" }),
      req({ stage: "ID", kind_code: "JOURNAL" }),
    ];
    const result = evaluate(requirements, [
      doc({ stage: "PD", kind_code: "ПЗ" }),
      doc({ stage: "RD", kind_code: "ОД" }),
      doc({ stage: "ID", kind_code: "JOURNAL" }),
    ]);
    expect(result.stages.PD?.status).toBe("PARTIAL");
    // Полностью закрыты только РД и ИД — сценарий честно называет их,
    // присутствие файлов ПД не превращает стадию в UPLOADED.
    expect(result.scenario).toBe("RD_ID_ONLY");
    expect(result.scenario).not.toBe("FULL");
  });

  it("детерминирован: порядок входов не меняет результат", () => {
    const requirements = [
      req({ stage: "PD", kind_code: "ПЗ" }),
      req({ stage: "PD", kind_code: "КР" }),
      req({ stage: "RD", kind_code: "ОД" }),
      req({ stage: "ID", kind_code: "JOURNAL" }),
    ];
    const documents = [
      doc({ stage: "PD", kind_code: "КР" }),
      doc({ stage: "PD", kind_code: "ПЗ" }),
      doc({ stage: "RD", kind_code: "ОД" }),
      doc({ stage: "ID", kind_code: "JOURNAL" }),
    ];
    const first = evaluate(requirements, documents);
    const second = evaluate(
      [...requirements].reverse(),
      [...documents].reverse(),
    );
    expect(first).toEqual(second);
    expect(first.scenario).toBe("FULL");
  });

  it("needs_review документ не закрывает требование, но удерживает его в unverifiable", () => {
    const requirements = [req({ stage: "ID", kind_code: "JOURNAL" })];
    const result = evaluate(requirements, [
      doc({ stage: "ID", kind_code: "JOURNAL", needs_review: true }),
    ]);
    expect(result.requirements[0]!.outcome).toBe("unverifiable");
    expect(result.requirements[0]!.reasons).toContain("kind_needs_review");
  });
});

describe("parameterGate", () => {
  const uploadedStages = {
    PD: {
      status: "UPLOADED" as const,
      applicable: 1,
      fulfilled: 1,
      missing: 0,
      unverifiable: 0,
    },
    RD: null,
    ID: null,
  };

  it("неприменимый параметр даёт NOT_APPLICABLE до проверки доказательств", () => {
    expect(
      parameterGate({
        parameterApplicable: false,
        relevantStages: ["PD"],
        stages: uploadedStages,
        evidencePresent: false,
        revisionUnresolved: true,
      }).gate,
    ).toBe("NOT_APPLICABLE");
  });

  it("неразрешённая стадия даёт CLARIFICATION_REQUIRED до MISSING_EVIDENCE", () => {
    const result = parameterGate({
      parameterApplicable: true,
      relevantStages: ["PD"],
      stages: {
        ...uploadedStages,
        PD: { ...uploadedStages.PD, unverifiable: 1, status: "PARTIAL" },
      },
      evidencePresent: false,
      revisionUnresolved: false,
    });
    expect(result.gate).toBe("CLARIFICATION_REQUIRED");
    expect(result.reasons).toContain("stage_unresolved");
  });

  it("пропуск обязательного документа даёт MISSING_EVIDENCE, не нарушение", () => {
    const result = parameterGate({
      parameterApplicable: true,
      relevantStages: ["PD"],
      stages: {
        ...uploadedStages,
        PD: {
          ...uploadedStages.PD,
          fulfilled: 0,
          missing: 1,
          status: "MISSING",
        },
      },
      evidencePresent: false,
      revisionUnresolved: false,
    });
    expect(result.gate).toBe("MISSING_EVIDENCE");
    expect(result.reasons).toContain("required_document_missing");
    expect(result.reasons).toContain("evidence_absent");
  });
});
