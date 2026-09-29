import SwaggerParser from "@apidevtools/swagger-parser";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Ajv } from "ajv";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { documentFactsFromSnapshot } from "../src/modules/completeness/completeness-engine.js";
import { ExtractionJobsService } from "../src/modules/extraction/extraction-jobs.service.js";
import type { ClassificationResult } from "../src/modules/identification/classification-contract.js";
import type { ClarificationBatch } from "../src/modules/identification/identification-contract.js";
import {
  clarificationResponseSchema,
  identificationRegistrySchema,
} from "../src/modules/identification/identification-openapi.js";
import {
  createIdentificationFixture,
  type IdentificationFixture,
  type SyntheticIdDocument,
} from "./helpers/identification-fixture.js";

let f: IdentificationFixture;
function body<T>(response: { body: unknown }): T {
  return response.body as T;
}
interface FindingDetail {
  finding: {
    run_id: string;
    members: { file_id: string; artifact_id: string }[];
  };
}
interface ExtractionResponse {
  run_id: string;
  current: boolean;
  active: boolean;
  tasks: { artifact_id: string; state: string }[];
  items: { artifact_id: string; file_id: string; evidence: unknown[] }[];
}
beforeAll(async () => {
  f = await createIdentificationFixture();
});
afterAll(async () => {
  await f?.close();
});
const A = "http://idActs/AOSR.xsd",
  C = "http://types/CommonTypes.xsd";
const path = (...tags: [string, string][]) =>
  tags.map(([ns, tag]) => `/{${ns}}${tag}[1]`).join("") + "/text()[1]";
const own = (tag: string) =>
  path([A, "aosr"], [A, "actInfo"], [C, "documentInfo"], [C, tag]);
const title = "Акт освидетельствования скрытых работ";
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
function rd(label: string, value: number): SyntheticIdDocument {
  const name = "Рабочая документация";
  return {
    format: "PDF",
    name: `РД-${label}.pdf`,
    classification: classified("RD", "KJ", name),
    blocks: [
      { text: name },
      { text: "Шифр: 23.009-Р-ГИ" },
      { text: `Редакция: ${label}` },
      { text: "Область работ: оси 1–3" },
      { text: "Дата документа: 01.01.2026" },
      { text: `Площадь: ${value} м2` },
    ],
  };
}
async function extract(runId: string) {
  const jobs = f.app.get(ExtractionJobsService);
  await jobs.recover();
  const tasks = await f.prisma.extractionTask.findMany({
    where: { artifact: { task: { runId } }, state: "queued" },
  });
  expect(tasks).toHaveLength(4);
  for (const task of tasks) await jobs.execute(task.id);
  expect(
    await f.prisma.extractionTask.count({
      where: { artifact: { task: { runId } }, state: "succeeded" },
    }),
  ).toBe(4);
}
function generate(objectId: string) {
  return request(f.server)
    .post(`/api/v1/objects/${objectId}/protocol/generate`)
    .auth(f.inspector.token, { type: "bearer" })
    .send({});
}

describe("whole-document identification through extraction and historical protocol", () => {
  it("fences a delayed extraction publication after its Run has been superseded", async () => {
    const source = await f.seed([
      {
        format: "PDF",
        blocks: [{ text: title }, { text: "Площадь: 10 м2" }],
        classification: classified("ID", "AOSR", title),
      },
    ]);
    await f.identify(source);
    await f.prisma.ruleVersion.upsert({
      where: { parameterCode_version: { parameterCode: "P900", version: 1 } },
      create: {
        parameterCode: "P900",
        parameterId: 900,
        version: 1,
        status: "approved",
        plan: { kind: "regex", anchors: ["площадь"], pattern: "(\\d+)" },
        approvedBy: f.admin.id,
        approvedAt: new Date(),
      },
      update: {},
    });
    const jobs = f.app.get(ExtractionJobsService);
    await jobs.recover();
    const task = await f.prisma.extractionTask.findFirstOrThrow({
      where: { artifactId: source.files[0]!.artifactId },
    });
    let release!: () => void, entered!: () => void;
    const paused = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const read = f.artifacts.read.bind(f.artifacts);
    const spy = vi
      .spyOn(f.artifacts, "read")
      .mockImplementationOnce(async (...args) => {
        entered();
        await paused;
        return read(...args);
      });
    const worker = jobs.execute(task.id);
    try {
      await reached;
      await f.prisma.$transaction(async (tx) => {
        await tx.process.update({
          where: { id: source.processId },
          data: { version: 2 },
        });
        await tx.run.create({
          data: {
            processId: source.processId,
            objectId: source.objectId,
            version: 2,
            inputManifest: {},
            inputManifestHash: "0".repeat(64),
          },
        });
      });
    } finally {
      release();
      await worker;
      spy.mockRestore();
    }
    expect(
      await f.prisma.extraction.count({ where: { taskId: task.id } }),
    ).toBe(0);
    expect(
      await f.prisma.extractionTask.findUniqueOrThrow({
        where: { id: task.id },
      }),
    ).toMatchObject({ state: "failed", errorCode: "extraction_superseded" });
  });
  it("publishes valid OpenAPI for process documents and strict clarifications", async () => {
    const document = SwaggerModule.createDocument(
      f.app,
      new DocumentBuilder()
        .setTitle("ID test")
        .setVersion("1")
        .addBearerAuth()
        .build(),
    );
    await SwaggerParser.validate(
      JSON.parse(JSON.stringify(document)) as Parameters<
        typeof SwaggerParser.validate
      >[0],
    );
    expect(
      document.paths["/api/v1/processes/{processId}/documents"]?.get?.responses[
        "200"
      ],
    ).toHaveProperty("content");
  });
  it("PDF/XML акт + две РД → уточнение → расчёт → новый период → новый Run с прежними доказательствами", async () => {
    const source = await f.seed([
      {
        format: "PDF",
        name: "Акт52.pdf",
        classification: classified("ID", "AOSR", title),
        blocks: [
          { text: title },
          { text: "АОСР № 52 от 20.04.2026" },
          { text: "Область работ: оси 1–3" },
          { text: "Период работ: 20.04.2026 — 21.04.2026" },
          { text: "Шифр рабочей документации: 23.009-Р-ГИ" },
          { text: "Площадь: 120 м2" },
        ],
      },
      {
        format: "XML",
        name: "Акт52.xml",
        blocks: [
          { text: title, path: own("name") },
          { text: "52", path: own("number") },
          { text: "2026-04-20", path: own("date") },
          {
            text: "2026-04-20",
            path: path(
              [A, "aosr"],
              [A, "actInfo"],
              [A, "worksDate"],
              [C, "beginDate"],
            ),
          },
          {
            text: "2026-04-21",
            path: path(
              [A, "aosr"],
              [A, "actInfo"],
              [A, "worksDate"],
              [C, "endDate"],
            ),
          },
          {
            text: "99",
            path: path(
              [A, "aosr"],
              [A, "actInfo"],
              [A, "attachmentsList"],
              [C, "number"],
            ),
          },
          { text: "Площадь: 120 м2" },
        ],
      },
      rd("2", 120),
      rd("1", 100), // An older revision uploaded later never wins by order.
    ]);
    await f.identify(source);
    const initial = await f.registry(source);
    expect(
      initial.documents
        .flatMap((doc) => doc.revisions)
        .filter((rev) => rev.fields.stage === "ID")
        .every((rev) => rev.fields.number === "52"),
    ).toBe(true);
    const revisions = initial.documents.flatMap((doc) => doc.revisions);
    const oldRevision = revisions.find(
      (rev) => rev.fields.revision_label === "1",
    )!;
    const newRevision = revisions.find(
      (rev) => rev.fields.revision_label === "2",
    )!;
    expect(oldRevision).toBeDefined();
    expect(newRevision).toBeDefined();
    const confirmation: ClarificationBatch = {
      request_id: randomUUID(),
      expected_run_id: source.runId,
      basis: "Сверены оригиналы акта, титулы РД и журнал работ",
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
            effective_from:
              rev.revision_id === newRevision.revision_id
                ? "2026-05-01"
                : "2026-01-01",
            effective_to:
              rev.revision_id === oldRevision.revision_id ? "2026-04-30" : null,
            replaces_revision_id:
              rev.revision_id === newRevision.revision_id
                ? oldRevision.revision_id
                : null,
          },
        })),
      })),
    };
    // Catalog and versions must exist before Run admission freezes them.
    const matrix = await f.prisma.matrixImport.create({
      data: {
        sourceName: "ID flow fixture",
        sourceSha256: "1".repeat(64),
        originSha256: "2".repeat(64),
        rowCount: 1,
      },
    });
    await f.prisma.matrixRow.create({
      data: {
        importId: matrix.id,
        parameterId: 22,
        parameterCode: "P022",
        pdSection: "ПЗ",
        name: "Площадь",
        sourceRd: "KJ",
        sourceId: "AOSR",
        triggerText: "площадь",
        matrixRow: 1,
        raw: {},
      },
    });
    await f.prisma.ruleVersion.create({
      data: {
        parameterCode: "P022",
        parameterId: 22,
        version: 1,
        status: "approved",
        plan: {
          kind: "regex",
          anchors: ["площадь"],
          pattern: "Площадь:\\s*(\\d+)",
          window_blocks: 0,
          type: "number",
        },
        comparison: { kind: "equals" },
        approvedBy: f.admin.id,
        approvedAt: new Date(),
      },
    });
    const applied = await f.apply(source, confirmation).expect(202);
    const firstRun = body<{ run_id: string }>(applied).run_id;
    const resolved = await f.registry(source);
    const ajv = new Ajv({ strict: false, validateFormats: false });
    const validateRegistry = ajv.compile(identificationRegistrySchema);
    expect(
      validateRegistry(resolved),
      ajv.errorsText(validateRegistry.errors),
    ).toBe(true);
    expect(ajv.compile(clarificationResponseSchema)(applied.body)).toBe(true);
    expect(resolved.documents).toHaveLength(2);
    expect(documentFactsFromSnapshot(resolved)).toHaveLength(2);
    const act = resolved.documents.find((doc) =>
      doc.revisions.some((rev) => rev.fields.stage === "ID"),
    )!;
    expect(act.revisions[0]!.representations).toHaveLength(2);
    const actContext = resolved.contexts.find(
      (ctx) => ctx.actual.document_id === act.document_id,
    )!;
    expect(actContext).toMatchObject({
      status: "READY",
      reference: { revision_id: oldRevision.revision_id },
    });

    await generate(source.objectId).expect(409);
    await extract(firstRun);
    const firstExtractionResponse = await request(f.server)
      .get(`/api/v1/objects/${source.objectId}/extractions`)
      .auth(f.inspector.token, { type: "bearer" })
      .expect(200);
    const firstExtractions = body<ExtractionResponse>(firstExtractionResponse);
    expect(firstExtractions).toMatchObject({
      run_id: firstRun,
      current: true,
      active: false,
    });
    expect(firstExtractions.tasks).toHaveLength(4);
    expect(
      new Set(firstExtractions.items.map((item) => item.artifact_id)).size,
    ).toBe(4);
    expect(
      firstExtractions.items.some((item) => item.evidence.length > 0),
    ).toBe(true);
    await generate(source.objectId).expect(201);
    const firstProtocol = await f.prisma.protocol.findFirstOrThrow({
      where: { objectId: source.objectId },
      include: { findings: true },
    });
    const firstFinding = firstProtocol.findings.find(
      (item) => item.scopeKey === actContext.context_id,
    )!;
    expect(firstFinding.status).toBe("CANDIDATE");
    const before = await request(f.server)
      .get(`/api/v1/objects/${source.objectId}/findings/${firstFinding.id}`)
      .auth(f.inspector.token, { type: "bearer" })
      .expect(200);
    expect(body<FindingDetail>(before).finding.members).toHaveLength(3);
    await request(f.server)
      .post(
        `/api/v1/objects/${source.objectId}/findings/${firstFinding.id}/decision`,
      )
      .auth(f.inspector.token, { type: "bearer" })
      .send({ request_id: randomUUID(), action: "confirm", finding_version: 1 })
      .expect(201);

    const correction: ClarificationBatch = {
      request_id: randomUUID(),
      expected_run_id: firstRun,
      basis: "Уточнён период выполнения по журналу работ",
      documents: [
        {
          document_id: act.document_id,
          expected_version: act.card_version,
          revisions: [
            {
              revision_id: act.revisions[0]!.revision_id,
              fields: { works_from: "2026-05-20", works_to: "2026-05-21" },
            },
          ],
        },
      ],
    };
    const next = await f.apply(source, correction).expect(202);
    const secondRun = body<{ run_id: string }>(next).run_id;
    expect(secondRun).not.toBe(firstRun);
    const replay = await f.apply(source, correction).expect(202);
    expect(body<{ run_id: string }>(replay).run_id).toBe(secondRun);
    const secondRegistry = await f.registry(source);
    const secondContext = secondRegistry.contexts.find(
      (ctx) => ctx.actual.document_id === act.document_id,
    )!;
    expect(secondContext).toMatchObject({
      status: "READY",
      reference: { revision_id: newRevision.revision_id },
    });
    expect(
      await f.prisma.file.count({ where: { objectId: source.objectId } }),
    ).toBe(4);
    const cached = await f.prisma.parsingTask.findMany({
      where: { runId: secondRun },
      include: { artifact: true },
    });
    expect(
      cached.every((task) => task.attempts === 0 && task.state === "succeeded"),
    ).toBe(true);
    expect(
      cached
        .map((task) => task.artifact!.id)
        .every((id) => !source.files.some((file) => file.artifactId === id)),
    ).toBe(true);
    await generate(source.objectId).expect(409);
    await extract(secondRun);
    const historicalExtractions = await request(f.server)
      .get(`/api/v1/objects/${source.objectId}/extractions`)
      .query({ run_id: firstRun })
      .auth(f.inspector.token, { type: "bearer" })
      .expect(200);
    expect(body<ExtractionResponse>(historicalExtractions)).toMatchObject({
      run_id: firstRun,
      current: false,
      active: false,
      items: firstExtractions.items,
      tasks: firstExtractions.tasks,
    });
    const latestExtractions = await request(f.server)
      .get(`/api/v1/objects/${source.objectId}/extractions`)
      .auth(f.inspector.token, { type: "bearer" })
      .expect(200);
    const latest = body<ExtractionResponse>(latestExtractions);
    expect(latest.run_id).toBe(secondRun);
    expect(latest.items).toHaveLength(firstExtractions.items.length);
    expect(new Set(latest.items.map((item) => item.artifact_id)).size).toBe(4);
    expect(
      latest.items.every(
        (item) =>
          !firstExtractions.items.some(
            (old) => old.artifact_id === item.artifact_id,
          ),
      ),
    ).toBe(true);
    await generate(source.objectId).expect(201);
    const current = await f.prisma.protocol.findFirstOrThrow({
      where: { objectId: source.objectId, status: "active" },
      include: { findings: true },
    });
    expect(current.runId).toBe(secondRun);
    const currentAct = current.findings.find(
      (item) => item.scopeKey === secondContext.context_id,
    )!;
    expect(currentAct.status).toBe("NEGATIVE_VERIFIED");
    expect(currentAct.decidedBy).toBeNull();
    const after = await request(f.server)
      .get(`/api/v1/objects/${source.objectId}/findings/${firstFinding.id}`)
      .auth(f.inspector.token, { type: "bearer" })
      .expect(200);
    expect(body<FindingDetail>(after).finding.members).toEqual(
      body<FindingDetail>(before).finding.members,
    );
    expect(body<FindingDetail>(after).finding.run_id).toBe(firstRun);
    const oldMember = body<FindingDetail>(after).finding.members[0]!;
    await request(f.server)
      .get(
        `/api/v1/objects/${source.objectId}/files/${oldMember.file_id}/parse`,
      )
      .query({ artifact_id: oldMember.artifact_id, run_id: firstRun })
      .auth(f.inspector.token, { type: "bearer" })
      .expect(200);
    await request(f.server)
      .post(`/api/v1/objects/${source.objectId}/protocol/finalize`)
      .auth(f.inspector.token, { type: "bearer" })
      .send({})
      .expect(201);
    const reloaded = await request(f.server)
      .get(`/api/v1/objects/${source.objectId}/protocol`)
      .auth(f.inspector.token, { type: "bearer" })
      .expect(200);
    expect(body<{ protocol: unknown }>(reloaded).protocol).toMatchObject({
      status: "finalized",
      run_id: secondRun,
      is_current: true,
    });
    expect((await f.registry(source)).allowed_actions.apply).toBe(false);
    await f
      .apply(source, {
        ...correction,
        request_id: randomUUID(),
        expected_run_id: secondRun,
      })
      .expect(409);
  });
});
