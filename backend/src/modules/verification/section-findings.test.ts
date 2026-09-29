import { describe, expect, it } from "vitest";

import type { SectionAnalysisOutput } from "../extraction/section-contract.js";
import {
  isSectionGrounded,
  parseSectionOutput,
  readSectionSnapshot,
  sectionFindingInputs,
  sectionFingerprint,
  sectionProtocolBasis,
  sectionResultFingerprint,
  SectionResultInvalidError,
  sectionResultStatus,
  toSectionSnapshot,
} from "./section-findings.js";

const MATRIX_ROWS = [
  {
    parameter_code: "P1",
    name: "Марка бетона",
    unit: "класс",
    source_pd: "ПД п.4",
    source_rd: null,
    source_id: "ИД ведомость",
    trigger: "все",
  },
  {
    parameter_code: "P2",
    name: "Отметка низа",
    unit: "м",
    source_pd: "ПД п.5",
    source_rd: null,
    source_id: null,
    trigger: "все",
  },
];

const TASK = { fingerprint: "task-fp-1", matrixRows: MATRIX_ROWS };

function sectionOutput(
  overrides: Partial<{
    assessment: string;
    fact: unknown;
    question: unknown;
    evidence: unknown[];
    missing_context: string[];
    coverage: { complete: boolean; missing: string[] };
    model: string;
    sources: unknown[];
    parameters: unknown[];
    contexts: unknown[];
  }> = {},
): unknown {
  return {
    schema_version: 1,
    engine: "section-context-v1",
    analysis_basis: {
      matrix_identity: "matrix-abc",
      model: overrides.model ?? "test-model",
      discovery_prompt_version: "section-discovery-v1",
      analysis_prompt_version: "section-analysis-v1",
    },
    contexts: overrides.contexts ?? [
      {
        context_id: "ctx-a",
        scope: "object",
        works_period: { from: "2026-01-01", to: null },
        reference: { document_id: "doc-pd", revision_id: "rev-pd" },
        actual: { document_id: "doc-id", revision_id: "rev-id" },
        sources: overrides.sources ?? [
          {
            source_ref: "reference:1",
            role: "reference",
            document_id: "doc-pd",
            revision_id: "rev-pd",
            document_stage: "PD",
            file_id: "file-pd",
            artifact_id: "art-pd",
            artifact_sha256: "sha-art-pd",
            source_sha256: "sha-src-pd",
            selection_hash: null,
            pages: [3, 4],
          },
          {
            source_ref: "actual:1",
            role: "actual",
            document_id: "doc-id",
            revision_id: "rev-id",
            document_stage: "ID",
            file_id: "file-id",
            artifact_id: "art-id",
            artifact_sha256: "sha-art-id",
            source_sha256: "sha-src-id",
            selection_hash: "sel-1",
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
          {
            section_id: "sec-3",
            source_ref: "reference:1",
            title: "Прочее",
            start_block_id: "b-15",
            end_block_id: "b-16",
            parameter_codes: ["P2"],
          },
        ],
        parameters: overrides.parameters ?? [
          {
            parameter_code: "P1",
            assessment: overrides.assessment ?? "potential_difference",
            fact:
              overrides.fact === undefined
                ? "В ИД указана марка B25 вместо B30 по ПД."
                : overrides.fact,
            evidence: overrides.evidence ?? [
              {
                source_ref: "reference:1",
                role: "reference",
                section_id: "sec-1",
                document_id: "doc-pd",
                revision_id: "rev-pd",
                file_id: "file-pd",
                artifact_id: "art-pd",
                page_number: 4,
                sheet_label: null,
                block_id: "b-12",
                table_id: null,
                table_row: null,
                table_column: null,
                quote: "Бетон В30",
                bbox: [1, 2, 3, 4],
                structural_path: "1/2",
              },
              {
                source_ref: "actual:1",
                role: "actual",
                section_id: "sec-2",
                document_id: "doc-id",
                revision_id: "rev-id",
                file_id: "file-id",
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
            missing_context: overrides.missing_context ?? [],
            question_for_inspector:
              overrides.question === undefined
                ? "Подтвердите фактическую марку бетона."
                : overrides.question,
          },
          {
            parameter_code: "P2",
            assessment: "insufficient_context",
            fact: null,
            evidence: [],
            missing_context: ["В ИД нет раздела с отметками"],
            question_for_inspector: null,
          },
        ],
        coverage: overrides.coverage ?? { complete: true, missing: [] },
      },
    ],
    skipped_contexts: [],
    calls_used: 3,
    failures: [],
  };
}

function parsedOutput(
  overrides?: Parameters<typeof sectionOutput>[0],
): SectionAnalysisOutput {
  return parseSectionOutput(sectionOutput(overrides));
}

describe("parseSectionOutput", () => {
  it("accepts a valid published output", () => {
    const output = parsedOutput();
    expect(output.contexts).toHaveLength(1);
    expect(output.contexts[0]!.parameters).toHaveLength(2);
    expect(output.analysis_basis.matrix_identity).toBe("matrix-abc");
  });

  it("rejects a foreign schema version", () => {
    const bad = {
      ...(sectionOutput() as Record<string, unknown>),
      schema_version: 2,
    };
    expect(() => parseSectionOutput(bad)).toThrowError(
      SectionResultInvalidError,
    );
  });

  it("rejects malformed evidence and unknown assessments", () => {
    expect(() =>
      parseSectionOutput(sectionOutput({ evidence: [{ role: "witness" }] })),
    ).toThrowError(SectionResultInvalidError);
    expect(() =>
      parseSectionOutput(sectionOutput({ assessment: "verified_ok" })),
    ).toThrowError(SectionResultInvalidError);
  });

  it("rejects a null or foreign page (VR3)", () => {
    const base = (
      sectionOutput() as {
        contexts: { parameters: { evidence: object[] }[] }[];
      }
    ).contexts[0]!.parameters[0]!.evidence;
    expect(() =>
      parseSectionOutput(
        sectionOutput({
          evidence: [{ ...(base[0] as object), page_number: null }, base[1]],
        }),
      ),
    ).toThrowError(SectionResultInvalidError);
    expect(() =>
      parseSectionOutput(
        sectionOutput({
          evidence: [{ ...(base[0] as object), page_number: 99 }, base[1]],
        }),
      ),
    ).toThrowError(/foreign_page/);
  });

  it("rejects citations rebound to another source or role (VR3)", () => {
    const base = (
      sectionOutput() as {
        contexts: { parameters: { evidence: object[] }[] }[];
      }
    ).contexts[0]!.parameters[0]!.evidence;
    // Role changed while the source_ref still points at the real source.
    expect(() =>
      parseSectionOutput(
        sectionOutput({
          evidence: [{ ...(base[0] as object), role: "actual" }, base[1]],
        }),
      ),
    ).toThrowError(/role_mismatch/);
    // Foreign source ref.
    expect(() =>
      parseSectionOutput(
        sectionOutput({
          evidence: [
            { ...(base[0] as object), source_ref: "reference:9" },
            base[1],
          ],
        }),
      ),
    ).toThrowError(/foreign_source/);
    // Artifact id that does not belong to the declared source.
    expect(() =>
      parseSectionOutput(
        sectionOutput({
          evidence: [
            { ...(base[0] as object), artifact_id: "art-other" },
            base[1],
          ],
        }),
      ),
    ).toThrowError(/source_mismatch/);
    // Section from another context source.
    expect(() =>
      parseSectionOutput(
        sectionOutput({
          evidence: [{ ...(base[0] as object), section_id: "sec-2" }, base[1]],
        }),
      ),
    ).toThrowError(/foreign_section/);
  });

  it("rejects malformed revision references (VR3)", () => {
    const ctx = (sectionOutput() as { contexts: object[] }).contexts[0]!;
    expect(() =>
      parseSectionOutput(
        sectionOutput({
          contexts: [{ ...ctx, reference: { document_id: "doc-pd" } }],
        }),
      ),
    ).toThrowError(/section_context_reference/);
    expect(() =>
      parseSectionOutput(
        sectionOutput({
          contexts: [{ ...ctx, actual: { revision_id: "r" } }],
        }),
      ),
    ).toThrowError(/section_context_reference/);
  });

  it("rejects non-finite bbox coordinates (VR3)", () => {
    const base = (
      sectionOutput() as {
        contexts: { parameters: { evidence: object[] }[] }[];
      }
    ).contexts[0]!.parameters[0]!.evidence;
    expect(() =>
      parseSectionOutput(
        sectionOutput({
          evidence: [
            { ...(base[0] as object), bbox: [0, Number.NaN, 2, 3] },
            base[1],
          ],
        }),
      ),
    ).toThrowError(/bbox/);
  });

  it("rejects duplicate and overlapping context ids (VR6)", () => {
    const ctx = (sectionOutput() as { contexts: object[] }).contexts[0]!;
    expect(() =>
      parseSectionOutput(sectionOutput({ contexts: [ctx, ctx] })),
    ).toThrowError(/section_context_duplicate/);
    // The same id cannot appear in both returned and skipped lists.
    const withSkipped = {
      ...(sectionOutput() as Record<string, unknown>),
      skipped_contexts: [
        { context_id: "ctx-a", reason: "identification_failed" },
      ],
    };
    expect(() => parseSectionOutput(withSkipped)).toThrowError(
      /section_context_duplicate/,
    );
    const dupSkipped = {
      ...(sectionOutput() as Record<string, unknown>),
      skipped_contexts: [
        { context_id: "ctx-b", reason: "x" },
        { context_id: "ctx-b", reason: "y" },
      ],
    };
    expect(() => parseSectionOutput(dupSkipped)).toThrowError(
      /section_context_duplicate/,
    );
  });

  it("rejects a grounded citation without a block id (VR7)", () => {
    const base = (
      sectionOutput() as {
        contexts: { parameters: { evidence: object[] }[] }[];
      }
    ).contexts[0]!.parameters[0]!.evidence;
    expect(() =>
      parseSectionOutput(
        sectionOutput({
          evidence: [{ ...(base[0] as object), block_id: null }, base[1]],
        }),
      ),
    ).toThrowError(/section_evidence_block/);
    expect(() =>
      parseSectionOutput(
        sectionOutput({
          evidence: [{ ...(base[0] as object), block_id: "  " }, base[1]],
        }),
      ),
    ).toThrowError(/section_evidence_block/);
  });

  it("accepts legacy sections without page bounds and valid ordered pairs (D7)", () => {
    // Legacy absence stays readable.
    expect(() => parsedOutput()).not.toThrow();
    const ctx = (
      sectionOutput() as {
        contexts: { sections: Record<string, unknown>[] }[];
      }
    ).contexts[0]!;
    const bounded = {
      ...ctx,
      sections: [
        { ...ctx.sections[0]!, start_page_number: 3, end_page_number: 4 },
        { ...ctx.sections[1]!, start_page_number: 10, end_page_number: 10 },
        ctx.sections[2]!,
      ],
    };
    const parsed = parseSectionOutput(sectionOutput({ contexts: [bounded] }));
    expect(parsed.contexts[0]!.sections[0]).toMatchObject({
      start_page_number: 3,
      end_page_number: 4,
    });
  });

  it("rejects malformed or foreign section page bounds (D7)", () => {
    const ctx = (
      sectionOutput() as {
        contexts: { sections: Record<string, unknown>[] }[];
      }
    ).contexts[0]!;
    const sec1 = ctx.sections[0]!;
    // One-sided pair.
    expect(() =>
      parseSectionOutput(
        sectionOutput({
          contexts: [
            {
              ...ctx,
              sections: [{ ...sec1, start_page_number: 3 }, ctx.sections[1]!],
            },
          ],
        }),
      ),
    ).toThrowError(/section_bounds_page_invalid/);
    // Reversed order.
    expect(() =>
      parseSectionOutput(
        sectionOutput({
          contexts: [
            {
              ...ctx,
              sections: [
                { ...sec1, start_page_number: 4, end_page_number: 3 },
                ctx.sections[1]!,
              ],
            },
          ],
        }),
      ),
    ).toThrowError(/section_bounds_page_invalid/);
    // Non-positive / non-integer pages.
    expect(() =>
      parseSectionOutput(
        sectionOutput({
          contexts: [
            {
              ...ctx,
              sections: [
                { ...sec1, start_page_number: 0, end_page_number: 4 },
                ctx.sections[1]!,
              ],
            },
          ],
        }),
      ),
    ).toThrowError(/section_bounds_page_invalid/);
    // Page outside the owning source's physical stream (reference:1 -> [3,4]).
    expect(() =>
      parseSectionOutput(
        sectionOutput({
          contexts: [
            {
              ...ctx,
              sections: [
                { ...sec1, start_page_number: 4, end_page_number: 9 },
                ctx.sections[1]!,
              ],
            },
          ],
        }),
      ),
    ).toThrowError(/section_bounds_foreign_page/);
  });

  it("rejects contradictory complete coverage and blank facts (VR4)", () => {
    expect(() =>
      parseSectionOutput(
        sectionOutput({
          coverage: { complete: true, missing: ["unreadable_page"] },
        }),
      ),
    ).toThrowError(/coverage_inconsistent/);
    expect(() =>
      parseSectionOutput(sectionOutput({ fact: "   " })),
    ).toThrowError(/section_fact_invalid/);
    expect(() =>
      parseSectionOutput(sectionOutput({ question: "  " })),
    ).toThrowError(/section_question_invalid/);
  });

  it("rejects internally contradictory row coverage (CR18)", () => {
    const ctx = (
      sectionOutput() as {
        contexts: { parameters: Record<string, unknown>[] }[];
      }
    ).contexts[0]!;
    const [p1, p2] = ctx.parameters;
    // A grounded verdict cannot carry its own declared coverage gap.
    expect(() =>
      parseSectionOutput(
        sectionOutput({
          parameters: [
            {
              ...p1,
              coverage: { complete: false, missing: ["chunk_omitted:sec-1:1"] },
            },
            p2,
          ],
        }),
      ),
    ).toThrowError(/section_coverage_inconsistent/);
    // Incomplete coverage with no stated reason is internally contradictory.
    expect(() =>
      parseSectionOutput(
        sectionOutput({
          parameters: [
            {
              ...p1,
              assessment: "insufficient_context",
              fact: null,
              evidence: [],
              missing_context: ["нет раздела"],
              coverage: { complete: false, missing: [] },
            },
            p2,
          ],
        }),
      ),
    ).toThrowError(/section_coverage_inconsistent/);
    // complete:true with leftovers is rejected by the shared validator.
    expect(() =>
      parseSectionOutput(
        sectionOutput({
          parameters: [
            { ...p1, coverage: { complete: true, missing: ["x"] } },
            p2,
          ],
        }),
      ),
    ).toThrowError(/section_coverage_inconsistent/);
  });
});

describe("sectionFindingInputs", () => {
  it("flattens contexts into parameter+scope inputs with frozen basis", () => {
    const output = parsedOutput();
    const inputs = sectionFindingInputs(TASK, output);
    expect(inputs).toHaveLength(2);
    const p1 = inputs.find((i) => i.parameter_code === "P1")!;
    expect(p1.context_id).toBe("ctx-a");
    expect(p1.matrix?.name).toBe("Марка бетона");
    expect(p1.task_fingerprint).toBe("task-fp-1");
    expect(p1.result_fingerprint).toBe(sectionResultFingerprint(output));
    // Sections bound to this parameter only (sec-3 covers P2).
    expect(p1.sections.map((s) => s.section_id).sort()).toEqual([
      "sec-1",
      "sec-2",
    ]);
    expect(p1.sources).toHaveLength(2);
    expect(p1.coverage.complete).toBe(true);
  });

  it("rejects unknown codes, duplicates and missing pinned codes (VR2)", () => {
    const ctx = (sectionOutput() as { contexts: { parameters: object[] }[] })
      .contexts[0]!;
    const p2 = ctx.parameters[1]!;
    // Unknown code not pinned in matrix_rows.
    expect(() =>
      sectionFindingInputs(
        TASK,
        parseSectionOutput(
          sectionOutput({
            parameters: [{ ...p2, parameter_code: "ZZ" }, p2],
          }),
        ),
      ),
    ).toThrowError(/section_unknown_parameter/);
    // Duplicate code inside one context.
    expect(() =>
      sectionFindingInputs(
        TASK,
        parseSectionOutput(sectionOutput({ parameters: [p2, p2] })),
      ),
    ).toThrowError(/section_duplicate_parameter|section_missing_parameter/);
    // A returned context must cover every pinned code.
    expect(() =>
      sectionFindingInputs(
        TASK,
        parseSectionOutput(sectionOutput({ parameters: [ctx.parameters[0]!] })),
      ),
    ).toThrowError(/section_missing_parameter/);
    // Corrupt pinned rows (duplicate code) are rejected by the core validator.
    expect(() =>
      sectionFindingInputs(
        { ...TASK, matrixRows: [MATRIX_ROWS[0]!, MATRIX_ROWS[0]!] },
        parsedOutput(),
      ),
    ).toThrowError(SectionResultInvalidError);
  });

  it("maps effective row coverage: parameter.coverage ?? context.coverage (CR18)", () => {
    const ctx = (
      sectionOutput() as {
        contexts: { parameters: Record<string, unknown>[] }[];
      }
    ).contexts[0]!;
    const [p1, p2] = ctx.parameters;
    // Aggregate incomplete because P2 has no section — P1's own coverage is
    // complete and stays reviewable; P2 keeps its own incomplete coverage.
    const output = parseSectionOutput(
      sectionOutput({
        contexts: [
          {
            ...ctx,
            coverage: {
              complete: false,
              missing: ["row_unanswered:P2"],
            },
            parameters: [
              { ...p1, coverage: { complete: true, missing: [] } },
              {
                ...p2,
                coverage: {
                  complete: false,
                  missing: ["row_unanswered:P2"],
                },
              },
            ],
          },
        ],
      }),
    );
    const inputs = sectionFindingInputs(TASK, output);
    const inputP1 = inputs.find((i) => i.parameter_code === "P1")!;
    const inputP2 = inputs.find((i) => i.parameter_code === "P2")!;
    expect(inputP1.coverage).toEqual({ complete: true, missing: [] });
    expect(inputP2.coverage).toEqual({
      complete: false,
      missing: ["row_unanswered:P2"],
    });
    expect(sectionResultStatus(inputP1)).toEqual({
      status: "CANDIDATE",
      reasons: [],
    });
    expect(sectionResultStatus(inputP2).status).toBe("MISSING_EVIDENCE");
    expect(sectionResultStatus(inputP2).reasons).toContain(
      "section_coverage_incomplete",
    );
  });

  it("keeps context-aggregate coverage for rows without row coverage (CR18 fallback)", () => {
    // Old payloads carry no parameter.coverage: effective coverage is the
    // context aggregate, exactly as before the field existed.
    const output = parsedOutput({
      coverage: { complete: false, missing: ["page_unreadable:sec-1:4"] },
    });
    expect(output.contexts[0]!.parameters[0]!.coverage).toBeUndefined();
    const [p1] = sectionFindingInputs(TASK, output);
    expect(p1!.coverage).toEqual({
      complete: false,
      missing: ["page_unreadable:sec-1:4"],
    });
  });

  it("preserves row coverage in the semantic result fingerprint", () => {
    const ctx = (
      sectionOutput() as {
        contexts: { parameters: Record<string, unknown>[] }[];
      }
    ).contexts[0]!;
    const [p1, p2] = ctx.parameters;
    const base = sectionResultFingerprint(parsedOutput());
    const scoped = parseSectionOutput(
      sectionOutput({
        parameters: [
          { ...p1, coverage: { complete: true, missing: [] } },
          { ...p2, coverage: { complete: false, missing: ["x"] } },
        ],
      }),
    );
    expect(sectionResultFingerprint(scoped)).not.toBe(base);
  });
});

describe("sectionResultStatus", () => {
  it("marks a complete grounded fact as CANDIDATE", () => {
    const [p1] = sectionFindingInputs(TASK, parsedOutput());
    expect(isSectionGrounded(p1!)).toBe(true);
    expect(sectionResultStatus(p1!)).toEqual({
      status: "CANDIDATE",
      reasons: [],
    });
  });

  it("keeps proposed_agreement a preliminary CANDIDATE, never a negative verification", () => {
    const [p1] = sectionFindingInputs(
      TASK,
      parsedOutput({ assessment: "proposed_agreement" }),
    );
    expect(sectionResultStatus(p1!).status).toBe("CANDIDATE");
  });

  it("maps insufficient context to MISSING_EVIDENCE with concrete reasons", () => {
    const inputs = sectionFindingInputs(TASK, parsedOutput());
    const p2 = inputs.find((i) => i.parameter_code === "P2")!;
    const result = sectionResultStatus(p2);
    expect(result.status).toBe("MISSING_EVIDENCE");
    expect(result.reasons).toContain("section_context_incomplete");
  });

  it("maps incomplete coverage to MISSING_EVIDENCE with machine reasons", () => {
    const [p1] = sectionFindingInputs(
      TASK,
      parsedOutput({
        coverage: { complete: false, missing: ["chunk_omitted:sec-2:1"] },
      }),
    );
    const result = sectionResultStatus(p1!);
    expect(result.status).toBe("MISSING_EVIDENCE");
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        "section_coverage_incomplete",
        "chunk_omitted:sec-2:1",
      ]),
    );
  });

  it("never produces a grounded candidate without both roles", () => {
    const oneSided = (
      sectionOutput() as {
        contexts: { parameters: { evidence: unknown[] }[] }[];
      }
    ).contexts[0]!.parameters[0]!.evidence.slice(0, 1);
    const [p1] = sectionFindingInputs(
      TASK,
      parseSectionOutput(sectionOutput({ evidence: oneSided })),
    );
    const result = sectionResultStatus(p1!);
    expect(result.status).toBe("MISSING_EVIDENCE");
    expect(result.reasons).toContain("section_role_missing");
  });
});

describe("sectionFingerprint", () => {
  const files = new Map([
    ["file-pd", "sha-file-pd"],
    ["file-id", "sha-file-id"],
  ]);

  it("is stable across run-scoped file/artifact ids under the same basis", () => {
    const [a] = sectionFindingInputs(TASK, parsedOutput());
    const renamed = sectionOutput();
    const contexts = (
      renamed as {
        contexts: {
          sources: { file_id: string; artifact_id: string }[];
          parameters: {
            evidence: { file_id: string; artifact_id: string }[];
          }[];
        }[];
      }
    ).contexts;
    for (const source of contexts[0]!.sources) {
      source.file_id = `${source.file_id}-next-run`;
      source.artifact_id = `${source.artifact_id}-next-run`;
    }
    for (const ev of contexts[0]!.parameters[0]!.evidence) {
      ev.file_id = `${ev.file_id}-next-run`;
      ev.artifact_id = `${ev.artifact_id}-next-run`;
    }
    const [b] = sectionFindingInputs({ ...TASK }, parseSectionOutput(renamed));
    const sha = new Map([
      ["file-pd-next-run", "sha-file-pd"],
      ["file-id-next-run", "sha-file-id"],
    ]);
    expect(sectionFingerprint(a!, files)).toBe(sectionFingerprint(b!, sha));
  });

  it("changes on any semantic change — fact, question, coverage, basis", () => {
    const [base] = sectionFindingInputs(TASK, parsedOutput());
    const changedFact = sectionFindingInputs(
      TASK,
      parsedOutput({ fact: "Другой факт" }),
    )[0]!;
    const changedModel = sectionFindingInputs(
      TASK,
      parsedOutput({ model: "other-model" }),
    )[0]!;
    const changedCoverage = sectionFindingInputs(
      TASK,
      parsedOutput({ coverage: { complete: false, missing: ["x"] } }),
    )[0]!;
    const fp = sectionFingerprint(base!, files);
    expect(sectionFingerprint(changedFact, files)).not.toBe(fp);
    expect(sectionFingerprint(changedModel, files)).not.toBe(fp);
    expect(sectionFingerprint(changedCoverage, files)).not.toBe(fp);
  });

  it("changes when the admitted task/result basis changes (VR1)", () => {
    const [base] = sectionFindingInputs(TASK, parsedOutput());
    const [otherTask] = sectionFindingInputs(
      { ...TASK, fingerprint: "task-fp-2" },
      parsedOutput(),
    );
    const [otherMatrix] = sectionFindingInputs(
      {
        ...TASK,
        matrixRows: MATRIX_ROWS.map((row) =>
          row.parameter_code === "P1" ? { ...row, name: "Другое имя" } : row,
        ),
      },
      parsedOutput(),
    );
    const fp = sectionFingerprint(base!, files);
    expect(sectionFingerprint(otherTask!, files)).not.toBe(fp);
    expect(sectionFingerprint(otherMatrix!, files)).not.toBe(fp);
  });
});

describe("toSectionSnapshot / readSectionSnapshot", () => {
  it("round-trips the versioned payload", () => {
    const [input] = sectionFindingInputs(TASK, parsedOutput());
    const snapshot = toSectionSnapshot(input!);
    expect(snapshot.schema_version).toBe(1);
    const back = readSectionSnapshot(JSON.parse(JSON.stringify(snapshot)));
    expect(back).not.toBeNull();
    expect(back!.parameter_code).toBe("P1");
    expect(back!.fact).toBe("В ИД указана марка B25 вместо B30 по ПД.");
    expect(back!.sections).toHaveLength(2);
    expect(back!.sources.map((s) => s.role).sort()).toEqual([
      "actual",
      "reference",
    ]);
    expect(back!.task_fingerprint).toBe("task-fp-1");
  });

  it("returns null for foreign payloads instead of trusting them", () => {
    expect(readSectionSnapshot(null)).toBeNull();
    expect(readSectionSnapshot({ schema_version: 2 })).toBeNull();
    expect(
      readSectionSnapshot({ schema_version: 1, parameter_code: 7 }),
    ).toBeNull();
  });
});

describe("sectionProtocolBasis", () => {
  it("reads only a well-formed recorded basis", () => {
    expect(sectionProtocolBasis(null)).toBeNull();
    expect(sectionProtocolBasis({})).toBeNull();
    expect(
      sectionProtocolBasis({ section_analysis: { task_fingerprint: "a" } }),
    ).toBeNull();
    expect(
      sectionProtocolBasis({
        section_analysis: {
          task_fingerprint: "a",
          result_fingerprint: "b",
        },
      }),
    ).toEqual({ task_fingerprint: "a", result_fingerprint: "b" });
  });
});
