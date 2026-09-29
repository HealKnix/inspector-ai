import {
  sectionAnalysisOutputSchema,
  sectionAnalysisSnapshotSchema,
  sectionAnalysisStatusSchema,
} from "./section-analysis";
import {
  sectionContextResult,
  sectionReferenceEvidence,
  sectionResults,
  sectionSnapshot,
  sectionStatus,
  sectionTask,
} from "./section-analysis-test-fixtures";
import { findingItemSchema } from "./verification";

const baseFinding = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  parameter_code: "P001",
  parameter_name: null,
  scope_key: "ctx-1",
  status: "CANDIDATE",
  risk: null,
  reason_code: null,
  comment: null,
  decided_at: null,
  has_evidence: true,
  evidence_preview: null,
  finding_version: 1,
  gate_reasons: [],
  verdict: null,
};

describe("section-analysis status schema", () => {
  it("retains task metadata and result contexts for the inspector", () => {
    const parsed = sectionAnalysisStatusSchema.parse(sectionStatus);
    expect(parsed.task?.id).toBe(sectionTask.id);
    expect(parsed.results?.contexts[0]?.parameters[0]?.fact).toBe(
      sectionSnapshot.fact,
    );
    expect(
      parsed.results?.contexts[0]?.parameters[0]?.evidence[0]?.file_id,
    ).toBe(sectionReferenceEvidence.file_id);
    expect(parsed.enabled).toBe(true);
  });

  it("accepts a disabled response without task or results", () => {
    const parsed = sectionAnalysisStatusSchema.parse({
      schema_version: 1,
      enabled: false,
      process_id: null,
      run_id: null,
      resolved_input_hash: null,
      current: false,
      active: false,
      poll_after_ms: 2000,
      task: null,
      results: null,
    });
    expect(parsed.task).toBeNull();
    expect(parsed.results).toBeNull();
  });
});

describe("section-analysis output schema", () => {
  it("keeps row-scoped coverage when the server fills it", () => {
    const parsed = sectionAnalysisOutputSchema.parse({
      ...sectionResults,
      contexts: [
        {
          ...sectionContextResult,
          parameters: [
            {
              ...sectionContextResult.parameters[0]!,
              coverage: { complete: true, missing: [] },
            },
            {
              ...sectionContextResult.parameters[0]!,
              parameter_code: "P002",
              assessment: "insufficient_context",
              fact: null,
              evidence: [],
              coverage: {
                complete: false,
                missing: ["row_unanswered:P002"],
              },
            },
          ],
          coverage: { complete: false, missing: ["row_unanswered:P002"] },
        },
      ],
    });
    const [covered, unanswered] = parsed.contexts[0]!.parameters;
    expect(covered?.coverage?.complete).toBe(true);
    expect(unanswered?.coverage?.complete).toBe(false);
    expect(unanswered?.coverage?.missing).toEqual(["row_unanswered:P002"]);
  });

  it("accepts legacy parameter results without row coverage", () => {
    const parsed = sectionAnalysisOutputSchema.parse(sectionResults);
    expect(parsed.contexts[0]?.parameters[0]?.coverage).toBeUndefined();
  });
});

describe("section snapshot schema", () => {
  it("retains the frozen payload needed for display and navigation", () => {
    const parsed = sectionAnalysisSnapshotSchema.parse(sectionSnapshot);
    expect(parsed.fact).toBe(sectionSnapshot.fact);
    expect(parsed.question_for_inspector).toBe(
      sectionSnapshot.question_for_inspector,
    );
    expect(parsed.matrix?.name).toBe(sectionSnapshot.matrix?.name);
    expect(parsed.evidence).toHaveLength(2);
    expect(parsed.sources.map((s) => s.role).sort()).toEqual([
      "actual",
      "reference",
    ]);
    expect(parsed.sections.map((s) => s.title)).toContain(
      "3. Конструктивные решения",
    );
  });

  it("strips unknown keys instead of failing the additive payload", () => {
    const parsed = sectionAnalysisSnapshotSchema.parse({
      ...sectionSnapshot,
      future_field: { ignored: true },
    });
    expect("future_field" in parsed).toBe(false);
    expect(parsed.fact).toBe(sectionSnapshot.fact);
  });

  it("rejects an assessment outside the contract", () => {
    expect(() =>
      sectionAnalysisSnapshotSchema.parse({
        ...sectionSnapshot,
        assessment: "confirmed_violation",
      }),
    ).toThrow();
  });
});

describe("finding.section_analysis compatibility", () => {
  it("parses a legacy finding without the additive payload", () => {
    const parsed = findingItemSchema.parse(baseFinding);
    expect(parsed.section_analysis).toBeUndefined();
  });

  it("keeps a null payload explicit and a frozen snapshot intact", () => {
    expect(
      findingItemSchema.parse({ ...baseFinding, section_analysis: null })
        .section_analysis,
    ).toBeNull();
    const parsed = findingItemSchema.parse({
      ...baseFinding,
      section_analysis: sectionSnapshot,
    });
    expect(parsed.section_analysis?.fact).toBe(sectionSnapshot.fact);
    expect(parsed.section_analysis?.evidence[0]?.artifact_id).toBe(
      sectionReferenceEvidence.artifact_id,
    );
  });
});
