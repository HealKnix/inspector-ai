import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SectionAnalysisWork } from "../src/modules/extraction/section-analysis-jobs.service.js";
import type { SectionAnalysisConfig } from "../src/modules/extraction/section-config.js";
import {
  SECTION_ENGINE_VERSION,
  type DiscoveryManifest,
  type SectionAnalysisOutput,
  type SectionMatrixRow,
  type SubmittedPart,
} from "../src/modules/extraction/section-contract.js";
import {
  runSectionAnalysis,
  type SectionLlm,
} from "../src/modules/extraction/section-engine.js";
import type { ClassificationResult } from "../src/modules/identification/classification-contract.js";
import type { ClarificationBatch } from "../src/modules/identification/identification-contract.js";
import type { ParseArtifactData } from "../src/modules/parsing/parsing-contract.js";
import type { IdentificationRegistry } from "./helpers/identification-fixture.js";
import {
  createSectionFixture,
  type SectionFixture,
} from "./helpers/section-analysis-fixture.js";

/**
 * Verification-side integration: real AppModule + real
 * SectionAnalysisJobsService bound to SECTION_ANALYSIS_PORT through the
 * production VerificationModule wiring. Documents, identification, matrix
 * and section tasks are real rows on a migrated database; the provider is a
 * scripted shape-aware SectionLlm driving the real runSectionAnalysis
 * engine — no fabricated task output, no live provider call.
 */

const digestTitle = "Акт освидетельствования скрытых работ";

/**
 * Executor config handed to the real engine. Provider fields are inert — the
 * scripted LLM replaces HTTP — but budgets must be honest so packing,
 * chunking and call accounting exercise the real paths.
 */
const ENGINE_TEST_CONFIG: SectionAnalysisConfig = {
  enabled: true,
  baseUrl: "http://scripted.invalid",
  model: "scripted-section-model-v1",
  apiKey: "scripted",
  requireParameters: false,
  timeoutMs: 5_000,
  maxRequestBytes: 262_144,
  maxResponseBytes: 65_536,
  maxCandidateBytes: 49_152,
  maxChunkBytes: 98_304,
  maxBlockCharacters: 4_000,
  maxParametersPerRequest: 8,
  maxCalls: 32,
  maxExpansionCandidates: 8,
};

function classified(
  stage: "ID" | "RD",
  kind: string,
  name: string,
): ClassificationResult {
  return {
    schema_version: 1,
    stage,
    kind_code: kind,
    document_kind: name,
    method: "rules",
    needs_review: false,
    reasons: [],
    candidates: [],
    evidence: [
      {
        page_number: 1,
        block_id: "p1:b0",
        quote: name,
        bbox: [0, 0, 1, 1],
        structural_path: null,
      },
    ],
    versions: {
      classifier: "synthetic",
      rules: "synthetic",
      context: "synthetic",
      prompt: "synthetic",
      model: null,
    },
  };
}

/**
 * The "Раздел …" blocks are real heading candidates — discovery must select
 * them as section endpoints, not document titles. The reference document
 * spans two pages so server-derived page bounds are meaningful.
 */
function actDocument() {
  return {
    format: "PDF" as const,
    name: "Акт52.pdf",
    classification: classified("ID", "AOSR", digestTitle),
    blocks: [
      { text: digestTitle },
      { text: "Раздел 2. Ведомость работ" },
      { text: "АОСР № 52 от 20.04.2026" },
      { text: "Область работ: оси 1–3" },
      { text: "Период работ: 20.04.2026 — 21.04.2026" },
      { text: "Шифр рабочей документации: 23.009-Р-ГИ" },
      { text: "Площадь: 120 м2" },
    ],
  };
}

function rdDocument() {
  return {
    format: "PDF" as const,
    name: "РД-1.pdf",
    classification: classified("RD", "KJ", "Рабочая документация"),
    pages: [
      [
        { text: "Рабочая документация" },
        { text: "Раздел 1. Общие данные" },
        { text: "Шифр: 23.009-Р-ГИ" },
        { text: "Редакция: 1" },
        { text: "Дата документа: 01.01.2026" },
      ],
      [{ text: "Область работ: оси 1–3" }, { text: "Площадь: 100 м2" }],
    ],
  };
}

interface ScriptedOptions {
  /**
   * Parameter codes the scripted discovery sections cover. Rows with no
   * covering section become row_unanswered with row-scoped coverage (CR18).
   */
  covered?: string[];
  fact?: string;
}

/**
 * Shape-aware scripted provider: discovery selects REAL manifest candidate
 * anchors and legal endpoint ids; analysis quotes REAL submitted blocks
 * (parts, or cited blocks on the reconciliation shape) and cites both roles.
 * Nothing here fabricates locators — the engine derives them server-side.
 */
function scriptedLlm(options: ScriptedOptions = {}): SectionLlm {
  return {
    call(kind, payload) {
      const body = payload as {
        manifest?: DiscoveryManifest;
        parameters?: SectionMatrixRow[];
        parts?: SubmittedPart[];
        cited_blocks?: {
          source_ref: string;
          block_id: string;
          text: string;
          role: "reference" | "actual";
        }[];
      };
      if (kind === "discovery") {
        const manifest = body.manifest!;
        const requested = manifest.parameters.map((row) => row.parameter_code);
        const codes = requested.filter((code) =>
          (options.covered ?? requested).includes(code),
        );
        const sections = codes.length
          ? manifest.sources.flatMap((source) => {
              const anchor = source.candidates[0];
              if (!anchor) return [];
              return [
                {
                  source_ref: source.source_ref,
                  title: `Раздел ${source.source_ref}`,
                  start_block_id: anchor.block_id,
                  end_block_id:
                    anchor.possible_end_block_ids[
                      anchor.possible_end_block_ids.length - 1
                    ] ?? anchor.block_id,
                  parameter_codes: codes,
                },
              ];
            })
          : [];
        return Promise.resolve({ sections, expand: [], missing_context: [] });
      }
      const blocks: {
        source_ref: string;
        block_id: string;
        role: "reference" | "actual";
        text: string;
      }[] = [];
      for (const part of body.parts ?? [])
        for (const block of part.blocks)
          if (block.text.trim())
            blocks.push({
              source_ref: part.source_ref,
              block_id: block.block_id,
              role: part.role,
              text: block.text.trim(),
            });
      for (const cited of body.cited_blocks ?? [])
        if (cited.text.trim())
          blocks.push({ ...cited, text: cited.text.trim() });
      const cite = (role: "reference" | "actual") => {
        const submitted = blocks.filter((item) => item.role === role);
        const block = submitted[submitted.length - 1];
        if (!block) return null;
        return {
          source_ref: block.source_ref,
          block_id: block.block_id,
          quote: block.text.slice(0, 80),
        };
      };
      const reference = cite("reference");
      const actual = cite("actual");
      const results = (body.parameters ?? []).map((row) => {
        if (!reference || !actual)
          return {
            parameter_code: row.parameter_code,
            assessment: "insufficient_context",
            fact: null,
            evidence: [],
            missing_context: ["submitted_parts_missing_role"],
            question_for_inspector: null,
          };
        return {
          parameter_code: row.parameter_code,
          assessment: "potential_difference",
          fact:
            options.fact ??
            `Расхождение ${row.parameter_code}: «${reference.quote}» против «${actual.quote}»`,
          evidence: [reference, actual],
          missing_context: [],
          question_for_inspector: `Подтвердите расхождение по ${row.parameter_code}.`,
        };
      });
      return Promise.resolve({ results });
    },
  };
}

/**
 * The same wiring as the production executor adapter — artifacts loaded from
 * the admitted manifest, then the real runSectionAnalysis engine over the
 * scripted provider and the durable work.index cache.
 */
function engineExecutor(options: ScriptedOptions = {}) {
  return async function impl(
    work: SectionAnalysisWork,
  ): Promise<SectionAnalysisOutput> {
    const loaded = new Map<string, ParseArtifactData>();
    for (const artifactId of work.artifact_ids) {
      const artifact = await work.readArtifact(artifactId);
      if (artifact) loaded.set(artifactId, artifact);
    }
    return runSectionAnalysis({
      snapshot: work.snapshot,
      artifactFor: (artifactId) => loaded.get(artifactId) ?? null,
      rows: work.matrix_rows,
      matrix_identity: work.matrix_sha256,
      config: ENGINE_TEST_CONFIG,
      llm: scriptedLlm(options),
      cache: work.index,
    });
  };
}

describe("section findings through the verification protocol", () => {
  let fixture: SectionFixture;
  beforeAll(async () => {
    fixture = await createSectionFixture();
  });
  afterAll(() => fixture.close());
  beforeEach(() => fixture.resetExecutor());

  async function registry(processId: string, runId?: string) {
    const response = await request(fixture.server)
      .get(
        `/api/v1/processes/${processId}/documents${runId ? `?run_id=${runId}` : ""}`,
      )
      .auth(fixture.inspector.token, { type: "bearer" });
    expect(response.status).toBe(200);
    return response.body as IdentificationRegistry;
  }

  function apply(processId: string, body: ClarificationBatch) {
    return request(fixture.server)
      .post(`/api/v1/processes/${processId}/document-resolutions`)
      .auth(fixture.inspector.token, { type: "bearer" })
      .send(body);
  }

  function generate(objectId: string) {
    return request(fixture.server)
      .post(`/api/v1/objects/${objectId}/protocol/generate`)
      .auth(fixture.inspector.token, { type: "bearer" })
      .send({});
  }

  function getProtocol(objectId: string) {
    return request(fixture.server)
      .get(`/api/v1/objects/${objectId}/protocol`)
      .auth(fixture.inspector.token, { type: "bearer" });
  }

  function decide(
    objectId: string,
    findingId: string,
    body: Record<string, unknown>,
  ) {
    return request(fixture.server)
      .post(`/api/v1/objects/${objectId}/findings/${findingId}/decision`)
      .auth(fixture.inspector.token, { type: "bearer" })
      .send(body);
  }

  function finalize(objectId: string) {
    return request(fixture.server)
      .post(`/api/v1/objects/${objectId}/protocol/finalize`)
      .auth(fixture.inspector.token, { type: "bearer" })
      .send({});
  }

  function admit(runId: string, codes?: string[]) {
    return {
      request_id: randomUUID(),
      expected_run_id: runId,
      ...(codes ? { parameter_codes: codes } : {}),
    };
  }

  /** Typed view of a response body — each assertion owns its shape. */
  function bodyOf<T>(response: { body: unknown }): T {
    return response.body as T;
  }

  interface ProtocolView {
    protocol: { status: string };
    is_current: boolean;
    versions: { version: number; is_current: boolean }[];
  }

  /**
   * Real ID+RD documents through real identification plus an inspector
   * clarification, so the new run carries a READY comparison context bound
   * to real artifacts. Seeding the matrix BEFORE the clarification makes
   * pinRunRelease pin the resolved run to a release whose catalog is the
   * seeded import — the normal production pinning path.
   */
  async function readyContext(codes = ["P001"]) {
    const source = await fixture.seed([actDocument(), rdDocument()]);
    await fixture.identify(source);
    const matrix = await fixture.seedMatrix(codes);
    const initial = await registry(source.processId, source.runId);
    const batch: ClarificationBatch = {
      request_id: randomUUID(),
      expected_run_id: source.runId,
      basis: "Сверены титулы и журнал работ",
      documents: initial.documents.map((doc) => ({
        document_id: doc.document_id,
        expected_version: doc.card_version,
        revisions: doc.revisions.map((rev) => ({
          revision_id: rev.revision_id,
          fields:
            rev.fields.stage === "ID"
              ? { scope: "оси 1–3", reference_code: "23.009-Р-ГИ" }
              : undefined,
          approval: {
            confirmed: true,
            basis: "Проверено инспектором",
            effective_from: "2026-01-01",
            effective_to: null,
            replaces_revision_id: null,
          },
        })),
      })),
    };
    const applied = await apply(source.processId, batch);
    expect(applied.status).toBe(202);
    const runId = (applied.body as { run_id: string }).run_id;
    const resolved = await registry(source.processId, runId);
    const ctx = resolved.contexts.find((item) => item.status === "READY");
    if (!ctx) throw new Error("No READY context: " + JSON.stringify(resolved));
    return { ...source, runId, context: ctx, matrix };
  }

  async function admitAndExecute(
    objectId: string,
    runId: string,
    codes?: string[],
  ) {
    const posted = await fixture.postSection(objectId, admit(runId, codes));
    expect(posted.status).toBe(202);
    const taskId = posted.body.task.id;
    await fixture.sectionJobs.execute(taskId);
    return fixture.prisma.sectionAnalysisTask.findUniqueOrThrow({
      where: { id: taskId },
    });
  }

  it("READY section-only finding via the real engine: generate → evidence → honest reject", async () => {
    const { objectId, runId } = await readyContext(["P001"]);
    fixture.executor.impl = engineExecutor();
    const task = await admitAndExecute(objectId, runId, ["P001"]);

    // The real engine produced the result — identity, not a stub marker.
    const output = task.result as unknown as SectionAnalysisOutput;
    expect(output.engine).toBe(SECTION_ENGINE_VERSION);
    expect(output.contexts).toHaveLength(1);
    // Discovery index was persisted into the durable cache, not recomputed.
    expect(await fixture.prisma.sectionIndexCache.count()).toBeGreaterThan(0);

    const generated = await generate(objectId).expect(201);
    expect(bodyOf<{ findings: number }>(generated).findings).toBe(1);
    const protocol = await fixture.prisma.protocol.findFirstOrThrow({
      where: { objectId, status: "active" },
      include: { findings: true },
    });
    // Protocol-level basis is recorded even though there is exactly one
    // section finding — idempotent freshness compares it, not the rows.
    expect(protocol.content).toMatchObject({
      section_analysis: { task_fingerprint: task.fingerprint },
    });
    const content = protocol.content as {
      findings: {
        parameter_code: string;
        status: string;
        section_assessment: string | null;
      }[];
      parameters_with_section_analysis: number;
    };
    expect(content.findings).toEqual([
      expect.objectContaining({
        parameter_code: "P001",
        status: "CANDIDATE",
        section_assessment: "potential_difference",
      }),
    ]);
    const finding = protocol.findings[0]!;
    expect(finding.status).toBe("CANDIDATE");
    expect(finding.evidenceGroupId).toBeNull();
    expect(finding.verdict).toBeNull();
    const frozen = finding.evidenceSnapshot as {
      section_analysis: {
        parameter_code: string;
        coverage: { complete: boolean };
        evidence: {
          role: string;
          section_id: string;
          block_id: string;
          page_number: number;
          quote: string;
        }[];
        sections: {
          section_id: string;
          source_ref: string;
          start_page_number?: number;
          end_page_number?: number;
        }[];
        matrix: { parameter_code: string };
      } | null;
    };
    expect(frozen.section_analysis).not.toBeNull();
    const section = frozen.section_analysis!;
    // Row-scoped effective coverage (CR18): complete for the covered row.
    expect(section.coverage.complete).toBe(true);
    // Real role-specific locators: quotes are real submitted blocks, not
    // document titles; page bounds are server-derived physical pages.
    const roles = section.evidence.map((item) => item.role).sort();
    expect(roles).toEqual(["actual", "reference"]);
    const referenceEv = section.evidence.find(
      (item) => item.role === "reference",
    )!;
    const actualEv = section.evidence.find((item) => item.role === "actual")!;
    expect(referenceEv.quote).toBe("Площадь: 100 м2");
    expect(referenceEv.page_number).toBe(2);
    expect(actualEv.quote).toBe("Площадь: 120 м2");
    expect(actualEv.page_number).toBe(1);
    for (const item of section.evidence)
      expect(item.block_id).toMatch(/^p\d+:b\d+$/);
    // The section owning the reference citation spans pages 1–2 for real.
    const refSection = section.sections.find(
      (item) => item.section_id === referenceEv.section_id,
    )!;
    expect(refSection.source_ref.startsWith("reference:")).toBe(true);
    expect(refSection.start_page_number).toBe(1);
    expect(refSection.end_page_number).toBe(2);
    expect(section.matrix.parameter_code).toBe("P001");

    const listed = await request(fixture.server)
      .get(`/api/v1/objects/${objectId}/findings`)
      .auth(fixture.inspector.token, { type: "bearer" })
      .expect(200);
    const item = (listed.body as { items: Record<string, unknown>[] })
      .items[0]!;
    expect(item.has_evidence).toBe(true);
    expect(item.section_analysis).toMatchObject({
      parameter_code: "P001",
      assessment: "potential_difference",
    });
    const detail = await request(fixture.server)
      .get(`/api/v1/objects/${objectId}/findings/${finding.id}`)
      .auth(fixture.inspector.token, { type: "bearer" })
      .expect(200);
    expect(
      (detail.body as { finding: { section_analysis: unknown } }).finding
        .section_analysis,
    ).toMatchObject({ matrix: { parameter_code: "P001" } });

    // Honest rejection with the explicit no_discrepancy reason.
    const decided = await decide(objectId, finding.id, {
      request_id: randomUUID(),
      action: "reject",
      finding_version: 1,
      reason_code: "no_discrepancy",
      comment: "Факт подтверждён документами, расхождения нет",
    }).expect(201);
    const decidedBody = bodyOf<{
      finding: { status: string };
      process_status: string;
    }>(decided);
    expect(decidedBody.finding.status).toBe("NEGATIVE_VERIFIED");
    expect(decidedBody.process_status).toBe("COMPLETED");
    await finalize(objectId).expect(201);
    const after = await getProtocol(objectId).expect(200);
    const afterBody = bodyOf<{
      protocol: { status: string };
      is_current: boolean;
    }>(after);
    expect(afterBody.protocol.status).toBe("finalized");
    expect(afterBody.is_current).toBe(true);
  });

  it("CR18 end to end: aggregate-incomplete context keeps P1 reviewable while P2 stays incomplete", async () => {
    const { objectId, runId } = await readyContext(["P001", "P002"]);
    // Scripted discovery covers P001 only — P002 has no section anywhere.
    fixture.executor.impl = engineExecutor({ covered: ["P001"] });
    const task = await admitAndExecute(objectId, runId, ["P001", "P002"]);
    const output = task.result as unknown as SectionAnalysisOutput;
    expect(output.engine).toBe(SECTION_ENGINE_VERSION);
    const context = output.contexts[0]!;
    // The context aggregate is incomplete (P002 unanswered) yet P001's own
    // row coverage is complete and its grounded fact survives.
    expect(context.coverage.complete).toBe(false);
    const p1 = context.parameters.find(
      (item) => item.parameter_code === "P001",
    )!;
    const p2 = context.parameters.find(
      (item) => item.parameter_code === "P002",
    )!;
    expect(p1.coverage).toEqual({ complete: true, missing: [] });
    expect(p1.assessment).toBe("potential_difference");
    expect(p2.coverage?.complete).toBe(false);
    expect(p2.assessment).toBe("insufficient_context");

    await generate(objectId).expect(201);
    const protocol = await fixture.prisma.protocol.findFirstOrThrow({
      where: { objectId, status: "active" },
      include: { findings: true },
    });
    const findingP1 = protocol.findings.find(
      (item) => item.parameterCode === "P001",
    )!;
    const findingP2 = protocol.findings.find(
      (item) => item.parameterCode === "P002",
    )!;
    expect(findingP1.status).toBe("CANDIDATE");
    expect(findingP2.status).not.toBe("CANDIDATE");
    const snapP2 = findingP2.evidenceSnapshot as {
      section_analysis: { coverage: { complete: boolean } } | null;
    };
    expect(snapP2.section_analysis?.coverage.complete).toBe(false);
    const content = protocol.content as {
      findings: { parameter_code: string; status: string }[];
    };
    expect(
      content.findings.find((item) => item.parameter_code === "P001")?.status,
    ).toBe("CANDIDATE");
  });

  it("selects only the latest NEW admission (A→B→new A→old B replay)", async () => {
    const { objectId, runId } = await readyContext(["P001", "P002"]);
    fixture.executor.impl = engineExecutor();
    const taskA = await admitAndExecute(objectId, runId, ["P001"]);
    await generate(objectId).expect(201);
    const first = await fixture.prisma.protocol.findFirstOrThrow({
      where: { objectId, status: "active" },
    });
    expect(first.content).toMatchObject({
      section_analysis: { task_fingerprint: taskA.fingerprint },
    });

    // A NEW admission for a different subset becomes the current basis;
    // while it is pending, generation and protocol currency are blocked.
    const postB = await fixture.postSection(objectId, admit(runId, ["P002"]));
    expect(postB.status).toBe(202);
    expect(postB.body.task.id).not.toBe(taskA.id);
    await generate(objectId).expect(409);
    const blocked = await getProtocol(objectId).expect(200);
    expect(bodyOf<ProtocolView>(blocked).is_current).toBe(false);
    const taskB = await fixture.prisma.sectionAnalysisTask.findUniqueOrThrow({
      where: { id: postB.body.task.id },
    });
    await fixture.sectionJobs.execute(taskB.id);
    await generate(objectId).expect(201);
    const second = await fixture.prisma.protocol.findFirstOrThrow({
      where: { objectId, status: "active" },
    });
    expect(second.version).toBe(2);
    expect(second.content).toMatchObject({
      section_analysis: { task_fingerprint: taskB.fingerprint },
    });

    // A NEW request for subset A re-selects cached task A.
    const postA2 = await fixture.postSection(objectId, admit(runId, ["P001"]));
    expect(postA2.body.task.id).toBe(taskA.id);
    // Replaying the OLD B request must not reactivate B's intent.
    const replayB = await fixture.postSection(objectId, {
      request_id: postB.body.request_id,
      expected_run_id: runId,
      parameter_codes: ["P002"],
    });
    expect(replayB.body.task.id).toBe(taskB.id);
    await generate(objectId).expect(201);
    const current = await fixture.prisma.protocol.findFirstOrThrow({
      where: { objectId, status: "active" },
    });
    expect(current.version).toBe(3);
    expect(current.content).toMatchObject({
      section_analysis: { task_fingerprint: taskA.fingerprint },
    });
    const protocol = await getProtocol(objectId).expect(200);
    const protocolView = bodyOf<ProtocolView>(protocol);
    expect(protocolView.is_current).toBe(true);
    // Currency is basis equality, not row identity: v1 and v3 share task A's
    // basis and may both read current; v2's B basis is gone.
    const versions = protocolView.versions;
    expect(versions.find((row) => row.version === 3)?.is_current).toBe(true);
    expect(versions.find((row) => row.version === 2)?.is_current).toBe(false);
  });

  it("pending replacement blocks decisions and finalize before any finalization", async () => {
    const { objectId, runId } = await readyContext(["P001", "P002"]);
    fixture.executor.impl = engineExecutor();
    await admitAndExecute(objectId, runId, ["P001"]);
    await generate(objectId).expect(201);

    // A pending replacement must block BEFORE the protocol can be
    // finalized: currency, decisions and finalization all fail on the
    // unawaited admitted basis. Nothing is decided or finalized yet.
    const postB = await fixture.postSection(objectId, admit(runId, ["P002"]));
    expect(postB.status).toBe(202);
    const taskB = await fixture.prisma.sectionAnalysisTask.findUniqueOrThrow({
      where: { id: postB.body.task.id },
    });
    const blocked = await getProtocol(objectId).expect(200);
    expect(bodyOf<ProtocolView>(blocked).is_current).toBe(false);
    const finding = await fixture.prisma.finding.findFirstOrThrow({
      where: { objectId, parameterCode: "P001" },
    });
    await decide(objectId, finding.id, {
      request_id: randomUUID(),
      action: "reject",
      finding_version: 1,
      reason_code: "not_applicable",
      comment: "Параметр не применим к данному этапу",
    }).expect(409);
    await finalize(objectId).expect(409);

    // A changed result (different fact) under a new task is a new basis:
    // still not current until the protocol is regenerated.
    fixture.executor.impl = engineExecutor({
      fact: "Изменённый факт секции.",
    });
    await fixture.sectionJobs.execute(taskB.id);
    const stale = await getProtocol(objectId).expect(200);
    expect(bodyOf<ProtocolView>(stale).is_current).toBe(false);
    await finalize(objectId).expect(409);
    await generate(objectId).expect(201);
    const current = await fixture.prisma.protocol.findFirstOrThrow({
      where: { objectId, status: "active" },
    });
    // Fingerprints compare to fingerprints — never to task row ids.
    expect(current.content).toMatchObject({
      section_analysis: { task_fingerprint: taskB.fingerprint },
    });
    const after = await getProtocol(objectId).expect(200);
    expect(bodyOf<ProtocolView>(after).is_current).toBe(true);
  });

  it("same snapshot with changed executor config is stale everywhere", async () => {
    const { objectId, runId } = await readyContext(["P001"]);
    fixture.executor.impl = engineExecutor();
    await admitAndExecute(objectId, runId, ["P001"]);
    await generate(objectId).expect(201);
    const finding = await fixture.prisma.finding.findFirstOrThrow({
      where: { objectId, parameterCode: "P001" },
    });

    // Identical resolved input with a changed model/config basis: the
    // admitted task is stale and blocks generation, currency and decisions.
    fixture.executor.configFingerprint = "f".repeat(64);
    await generate(objectId).expect(409);
    const staleConfig = await getProtocol(objectId).expect(200);
    expect(bodyOf<ProtocolView>(staleConfig).is_current).toBe(false);
    await decide(objectId, finding.id, {
      request_id: randomUUID(),
      action: "confirm",
      finding_version: 1,
    }).expect(409);
    await finalize(objectId).expect(409);
    // Restoring the config restores the basis: the same task is valid again.
    fixture.executor.configFingerprint = "e".repeat(64);
    const restored = await generate(objectId).expect(201);
    expect(bodyOf<{ reused: boolean }>(restored).reused).toBe(true);
    const after = await getProtocol(objectId).expect(200);
    expect(bodyOf<ProtocolView>(after).is_current).toBe(true);
  });

  it("a pinned release matrix stays current despite an unrelated newer import", async () => {
    // readyContext seeds the matrix before the clarification, so the resolved
    // run pins that exact import through pinRunRelease's release catalog.
    const { objectId, runId, matrix } = await readyContext(["P001"]);
    const run = await fixture.prisma.run.findUniqueOrThrow({
      where: { id: runId },
      include: { ruleSetRelease: true },
    });
    expect(run.ruleSetReleaseId).not.toBeNull();
    const catalog = (
      run.ruleSetRelease!.manifest as {
        catalog: { import_id: string } | null;
      }
    ).catalog;
    expect(catalog?.import_id).toBe(matrix.id);
    fixture.executor.impl = engineExecutor();
    const task = await admitAndExecute(objectId, runId, ["P001"]);
    // Admission pinned the release's catalog import, not "the latest".
    expect(task.matrixImportId).toBe(matrix.id);
    await generate(objectId).expect(201);

    // An unrelated newer import cannot invalidate the pinned basis.
    await fixture.seedMatrix(["P777"]);
    await generate(objectId).expect(201);
    const protocol = await getProtocol(objectId).expect(200);
    expect(bodyOf<ProtocolView>(protocol).is_current).toBe(true);
    const current = await fixture.prisma.protocol.findFirstOrThrow({
      where: { objectId, status: "active" },
    });
    expect(current.content).toMatchObject({
      section_analysis: { task_fingerprint: task.fingerprint },
    });
  });

  it("zero-context result still records protocol basis (idempotence)", async () => {
    const { objectId, runId } = await readyContext(["P001"]);
    // Default executor returns an empty-context result — still a real basis.
    const task = await admitAndExecute(objectId, runId, ["P001"]);
    await generate(objectId).expect(201);
    const protocol = await fixture.prisma.protocol.findFirstOrThrow({
      where: { objectId, status: "active" },
      include: { findings: true },
    });
    expect(protocol.content).toMatchObject({
      section_analysis: { task_fingerprint: task.fingerprint },
    });
    const content = protocol.content as {
      parameters_with_section_analysis: number;
      findings: { section_assessment: string | null }[];
    };
    expect(content.parameters_with_section_analysis).toBe(0);
    expect(
      content.findings.every((item) => item.section_assessment === null),
    ).toBe(true);
    expect(
      protocol.findings.every(
        (item) =>
          (item.evidenceSnapshot as { section_analysis: unknown })
            .section_analysis === null,
      ),
    ).toBe(true);
  });

  it("disabled executor is inert: frozen history readable, legacy decisions work", async () => {
    const { objectId, runId } = await readyContext(["P001"]);
    fixture.executor.impl = engineExecutor();
    await admitAndExecute(objectId, runId, ["P001"]);
    await generate(objectId).expect(201);
    const finding = await fixture.prisma.finding.findFirstOrThrow({
      where: { objectId, parameterCode: "P001" },
    });

    fixture.executor.enabled = false;
    const disabled = await getProtocol(objectId).expect(200);
    expect(bodyOf<ProtocolView>(disabled).is_current).toBe(true);
    // The frozen section payload stays readable while the feature is off.
    const detail = await request(fixture.server)
      .get(`/api/v1/objects/${objectId}/findings/${finding.id}`)
      .auth(fixture.inspector.token, { type: "bearer" })
      .expect(200);
    expect(
      (detail.body as { finding: { section_analysis: unknown } }).finding
        .section_analysis,
    ).toMatchObject({ parameter_code: "P001" });
    // Decisions follow the legacy basis only — a grounded candidate is
    // still decidable while the feature is disabled.
    const decided = await decide(objectId, finding.id, {
      request_id: randomUUID(),
      action: "clarify",
      finding_version: 1,
      comment: "Требуется уточнение контекста",
    }).expect(201);
    expect(
      bodyOf<{ finding: { status: string } }>(decided).finding.status,
    ).toBe("CLARIFICATION_REQUIRED");
  });
});
