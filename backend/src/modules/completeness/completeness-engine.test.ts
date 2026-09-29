import { describe, expect, it } from "vitest";
import type {
  IdentificationRevision,
  IdentificationSnapshot,
} from "../identification/identification-contract.js";
import type {
  DocumentFact,
  ExpectedRequirement,
} from "./completeness-contract.js";
import {
  documentFactsFromSnapshot,
  evaluate,
  parameterGate,
} from "./completeness-engine.js";

let seq = 0;

function snapshotRevision(id: string): IdentificationRevision {
  return {
    revision_id: id,
    fields: { stage: "ID", kind_code: "AOSR", scope: "Устройство свай" },
    candidates: [],
    representations: [
      {
        file_id: "file",
        artifact_id: "artifact",
        artifact_sha256: "a",
        source_sha256: "sha",
        format: "PDF",
        page_count: 1,
      },
    ],
    approval: {
      confirmed: true,
      effective_from: "2026-01-01",
      effective_to: null,
      replaces_revision_id: null,
      basis: "Синтетическое подтверждение",
    },
    blockers: [],
  };
}

describe("completeness uses the selected logical documents", () => {
  const snapshot = (
    ...revisions: IdentificationRevision[]
  ): IdentificationSnapshot => ({
    schema_version: 1,
    documents: [{ document_id: "logical-doc", card_version: 1, revisions }],
    contexts: [],
    blockers: [],
  });
  it("PDF and XML with different bytes count as one logical document", () => {
    const revision = snapshotRevision("revision");
    revision.representations.push({
      ...revision.representations[0]!,
      file_id: "xml",
      artifact_id: "xml-artifact",
      source_sha256: "different-xml-sha",
      format: "XML",
    });
    const facts = documentFactsFromSnapshot(snapshot(revision));
    expect(facts).toHaveLength(1);
    const result = evaluate(
      [
        req({
          stage: "ID",
          kind_code: "AOSR",
          quantity: { min: 2, per: null },
        }),
      ],
      facts,
    );
    expect(result.requirements[0]!.outcome).toBe("missing");
  });
  it("different logical documents are not collapsed merely because bytes match", () => {
    const result = evaluate(
      [
        req({
          stage: "ID",
          kind_code: "AOSR",
          quantity: { min: 2, per: null },
        }),
      ],
      [
        doc({
          stage: "ID",
          kind_code: "AOSR",
          document_id: "one",
          sha256: "same",
        }),
        doc({
          stage: "ID",
          kind_code: "AOSR",
          document_id: "two",
          sha256: "same",
        }),
      ],
    );
    expect(result.requirements[0]!.outcome).toBe("fulfilled");
  });
  it("only confirmed own scope covers an item, without substring inference", () => {
    const revision = snapshotRevision("revision");
    const requirement = req({
      stage: "ID",
      kind_code: "AOSR",
      scope: { item: "Устройство свай" },
    });
    expect(
      evaluate([requirement], documentFactsFromSnapshot(snapshot(revision)))
        .requirements[0]!.outcome,
    ).toBe("fulfilled");
    revision.approval.confirmed = false;
    const facts = documentFactsFromSnapshot(snapshot(revision));
    expect(facts[0]!.needs_review).toBe(false);
    expect(evaluate([requirement], facts).requirements[0]!.outcome).toBe(
      "unverifiable",
    );
    revision.approval.confirmed = true;
    revision.fields.scope = "Устройство свай в осях 1–3";
    expect(
      evaluate([requirement], documentFactsFromSnapshot(snapshot(revision)))
        .requirements[0]!.outcome,
    ).toBe("unverifiable");
  });
  it("unresolved multiple revisions or unsupported mixed input cannot give FULL", () => {
    expect(
      documentFactsFromSnapshot(
        snapshot(snapshotRevision("one"), snapshotRevision("two")),
      )[0]!.needs_review,
    ).toBe(true);
    const revision = snapshotRevision("mixed");
    revision.blockers = ["unsupported_mixed_document"];
    expect(documentFactsFromSnapshot(snapshot(revision))[0]!.needs_review).toBe(
      true,
    );
  });
  it("uses the reference revision pinned in a READY context instead of an older revision", () => {
    const old = snapshotRevision("old");
    old.fields.kind_code = "OTHER";
    const selected = snapshotRevision("new");
    const input = snapshot(old, selected);
    input.contexts.push({
      context_id: "context",
      scope: "Устройство свай",
      works_period: { from: "2026-01-01", to: "2026-01-02" },
      reference: { document_id: "logical-doc", revision_id: "new" },
      actual: { document_id: "another-doc", revision_id: "act" },
      status: "READY",
      blockers: [],
    });
    expect(documentFactsFromSnapshot(input)[0]).toMatchObject({
      revision_ids: ["new"],
      kind_code: "AOSR",
      needs_review: false,
    });
  });
});
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
    covered_items: [],
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

  it("документ, покрывающий пункт перечня, исполняет scoped-требование", () => {
    const requirements = [
      req({
        stage: "ID",
        kind_code: "AOSR",
        scope: { item: "Устройство свай" },
        quantity: { min: 1, per: "hidden_works" },
      }),
    ];
    const result = evaluate(requirements, [
      doc({
        stage: "ID",
        kind_code: "AOSR",
        covered_items: ["устройство свай"],
      }),
    ]);
    expect(result.requirements[0]!.outcome).toBe("fulfilled");
    expect(result.requirements[0]!.matched).toHaveLength(1);
  });

  it("акт на другую работу не закрывает scoped-требование", () => {
    const requirements = [
      req({
        stage: "ID",
        kind_code: "AOSR",
        scope: { item: "устройство свай" },
        quantity: { min: 1, per: "hidden_works" },
      }),
    ];
    const result = evaluate(requirements, [
      doc({
        stage: "ID",
        kind_code: "AOSR",
        covered_items: ["гидроизоляция фундамента"],
      }),
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

  it("сводит причины и не считает fulfilled требование с min=0 требуемым", () => {
    const requirements = [
      req({
        code: "RD-PDOC",
        stage: "RD",
        kind_code: "PDOC",
        quantity: { min: 0, per: null },
      }),
      req({ stage: "ID", kind_code: "JOURNAL" }),
      req({ stage: "ID", kind_code: "AOSR" }),
    ];
    const result = evaluate(requirements, [
      doc({ stage: "ID", kind_code: "JOURNAL" }),
      doc({ stage: "ID", kind_code: null }),
    ]);
    expect(result.counts.fulfilled).toBe(2);
    expect(result.counts.fulfilled_required).toBe(1);
    expect(result.counts.unverifiable).toBe(1);
    expect(result.counts.reasons).toEqual({ kind_unresolved: 1 });
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
