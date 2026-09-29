import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GroupVerdict } from "../src/modules/extraction/comparison-engine.js";
import { ExtractionJobsService } from "../src/modules/extraction/extraction-jobs.service.js";
import type {
  ClarificationBatch,
  IdentificationRevision,
} from "../src/modules/identification/identification-contract.js";
import {
  createIdentificationFixture,
  type IdentificationFixture,
  type SyntheticIdDocument,
} from "./helpers/identification-fixture.js";

let f: IdentificationFixture;
beforeAll(async () => {
  f = await createIdentificationFixture();
});
afterAll(async () => {
  await f?.close();
});

function document(
  stage: "RD" | "ID",
  label: string,
  values: number[],
): SyntheticIdDocument {
  const title =
    stage === "RD"
      ? "Рабочая документация"
      : "Акт освидетельствования скрытых работ";
  const metadata = [
    title,
    "Шифр: RD-1",
    `Редакция: ${label}`,
    "Область работ: оси 1–3",
    "Дата документа: 01.01.2026",
  ];
  return {
    format: "PDF",
    name: `${stage}-${label}.pdf`,
    pages: values.map((value, index) =>
      [...(index === 0 ? metadata : []), `Площадь: ${value} м2`].map(
        (text) => ({ text }),
      ),
    ),
    classification: {
      schema_version: 1,
      stage,
      kind_code: stage === "RD" ? "KJ" : "AOSR",
      document_kind: title,
      method: "rules",
      needs_review: false,
      reasons: [],
      candidates: [],
      evidence: [
        {
          page_number: 1,
          block_id: "p1:b0",
          quote: title,
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
    },
  };
}
function map(revision: IdentificationRevision, labels: string[]) {
  return {
    file_id: revision.representations[0]!.file_id,
    source_sha256: revision.representations[0]!.source_sha256,
    sheets: labels.map((label, index) => ({ label, page_number: index + 1 })),
    excluded_pages: [],
    basis: "Синтетическая сверка страниц",
  };
}
async function extract(runId: string) {
  const jobs = f.app.get(ExtractionJobsService);
  await jobs.recover();
  const tasks = await f.prisma.extractionTask.findMany({
    where: { artifact: { task: { runId } }, state: "queued" },
  });
  expect(tasks).toHaveLength(3);
  for (const task of tasks) await jobs.execute(task.id);
  expect(
    await f.prisma.extractionTask.count({
      where: { id: { in: tasks.map((task) => task.id) }, state: "succeeded" },
    }),
  ).toBe(3);
}
describe("sheet decisions through real PostgreSQL/HTTP/EXT (synthetic PAR)", () => {
  it("replaces 1/4/8, preserves the remaining sheets and historical protocol, rejects invalid/stale/foreign decisions", async () => {
    const source = await f.seed([
      document("RD", "1", [99, 30, 30, 99, 30, 30, 30, 99]),
      document("RD", "2", [30, 30, 30]),
      document("ID", "3", [30]),
    ]);
    await f.identify(source);
    const initial = await f.registry(source);
    const revisionByFile = (index: number) =>
      initial.documents
        .flatMap((d) => d.revisions)
        .find((r) =>
          r.representations.some(
            (rep) => rep.file_id === source.files[index]!.fileId,
          ),
        )!;
    const base = revisionByFile(0),
      replacement = revisionByFile(1),
      actual = revisionByFile(2);
    expect(base).toBeDefined();
    const matrix = await f.prisma.matrixImport.create({
      data: {
        sourceName: "Synthetic sheet flow",
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
        name: "Синтетическая площадь",
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
    const batch: ClarificationBatch = {
      request_id: randomUUID(),
      expected_run_id: source.runId,
      basis: "Синтетическая проверка замены 1/4/8",
      documents: initial.documents.map((doc) => ({
        document_id: doc.document_id,
        expected_version: doc.card_version,
        revisions: doc.revisions.map((rev) => ({
          revision_id: rev.revision_id,
          fields: {
            code: "RD-1",
            scope: "оси 1–3",
            ...(rev.revision_id === actual.revision_id
              ? {
                  reference_code: "RD-1",
                  works_from: "2026-06-01",
                  works_to: "2026-06-02",
                }
              : {}),
          },
          approval: {
            confirmed: true,
            effective_from:
              rev.revision_id === replacement.revision_id
                ? "2026-05-01"
                : "2026-01-01",
            effective_to: null,
            replaces_revision_id: null,
            basis: "Синтетическое подтверждение применимости",
          },
          ...(rev.revision_id === base.revision_id
            ? { sheet_map: map(rev, ["1", "2", "3", "4", "5", "6", "7", "8"]) }
            : {}),
          ...(rev.revision_id === replacement.revision_id
            ? {
                sheet_map: map(rev, ["1", "4", "8"]),
                sheet_replacement: {
                  predecessor_revision_id: base.revision_id,
                  replaced_labels: ["1", "4", "8"],
                  basis: "Синтетическое разрешение на замену",
                },
              }
            : {}),
        })),
      })),
    };
    await f.apply(source, batch, f.outsider).expect(403);
    for (const problem of ["hash", "page", "label", "full", "cycle"] as const) {
      const invalid = structuredClone(batch);
      invalid.request_id = randomUUID();
      const edit = invalid.documents
        .flatMap((d) => d.revisions)
        .find((r) => r.revision_id === replacement.revision_id)!;
      if (problem === "hash") edit.sheet_map!.source_sha256 = "e".repeat(64);
      if (problem === "page") edit.sheet_map!.sheets[0]!.page_number = 4;
      if (problem === "label") {
        edit.sheet_map!.sheets[0]!.label = "99";
        edit.sheet_replacement!.replaced_labels[0] = "99";
      }
      if (problem === "full")
        edit.approval!.replaces_revision_id = base.revision_id;
      if (problem === "cycle")
        edit.sheet_replacement!.predecessor_revision_id =
          replacement.revision_id;
      await f.apply(source, invalid).expect(400);
    }
    expect(
      await f.prisma.run.count({ where: { processId: source.processId } }),
    ).toBe(1);
    expect(
      await f.prisma.clarification.count({
        where: { processId: source.processId },
      }),
    ).toBe(0);
    const applied = await f.apply(source, batch);
    expect(applied.status, JSON.stringify(applied.body)).toBe(202);
    const firstRun = (applied.body as { run_id: string }).run_id;
    const replay = await f.apply(source, batch).expect(202);
    expect(replay.body as { run_id: string; replayed: boolean }).toMatchObject({
      run_id: firstRun,
      replayed: true,
    });
    await f.apply(source, { ...batch, request_id: randomUUID() }).expect(409);
    const resolved = await f.registry(source);
    const context = resolved.contexts.find(
      (c) => c.actual.revision_id === actual.revision_id,
    )!;
    expect(context.status, JSON.stringify(context.blockers)).toBe("READY");
    expect(
      context.sheet_selection!.reference!.sheets.map((s) => [
        s.label,
        s.revision_id,
        s.page_number,
      ]),
    ).toEqual([
      ["1", replacement.revision_id, 1],
      ["2", base.revision_id, 2],
      ["3", base.revision_id, 3],
      ["4", replacement.revision_id, 2],
      ["5", base.revision_id, 5],
      ["6", base.revision_id, 6],
      ["7", base.revision_id, 7],
      ["8", replacement.revision_id, 3],
    ]);
    await extract(firstRun);
    const group = await f.prisma.evidenceGroup.findFirstOrThrow({
      where: { runId: firstRun, contextKey: context.context_id },
      orderBy: { createdAt: "desc" },
    });
    expect((group.verdict as unknown as GroupVerdict).status).toBe("match");
    const selected = await f.prisma.extraction.findMany({
      where: { runId: firstRun, fileId: source.files[0]!.fileId },
      include: { evidence: true },
    });
    expect(selected.length).toBeGreaterThan(0);
    expect(
      selected.every((e) => e.selectionKey !== null && e.value === 30),
    ).toBe(true);
    expect(
      selected
        .flatMap((e) => e.evidence.map((p) => p.pageNumber))
        .some((page) => [1, 4, 8].includes(page)),
    ).toBe(false);
    await request(f.server)
      .post(`/api/v1/objects/${source.objectId}/protocol/generate`)
      .auth(f.inspector.token, { type: "bearer" })
      .send({})
      .expect(201);
    const protocol = await f.prisma.protocol.findFirstOrThrow({
      where: { runId: firstRun },
      include: { findings: true },
    });
    const oldRegistry = await f.registry(source, firstRun);
    const changedDoc = resolved.documents.find((d) =>
      d.revisions.some((r) => r.revision_id === replacement.revision_id),
    )!;
    const changedRev = changedDoc.revisions.find(
      (r) => r.revision_id === replacement.revision_id,
    )!;
    const correction: ClarificationBatch = {
      request_id: randomUUID(),
      expected_run_id: firstRun,
      basis: "Новое синтетическое основание",
      documents: [
        {
          document_id: changedDoc.document_id,
          expected_version: changedDoc.card_version,
          revisions: [
            {
              revision_id: changedRev.revision_id,
              sheet_map: {
                ...changedRev.sheet_map!,
                basis: "Повторная сверка карты по другому основанию",
              },
            },
          ],
        },
      ],
    };
    const response = await f.apply(source, correction).expect(202);
    const secondRun = (response.body as { run_id: string }).run_id;
    expect(secondRun).not.toBe(firstRun);
    const current = await f.registry(source);
    expect(
      current.contexts.find((c) => c.actual.revision_id === actual.revision_id)!
        .context_id,
    ).not.toBe(context.context_id);
    await extract(secondRun);
    const historical = await f.registry(source, firstRun);
    expect(historical.documents).toEqual(oldRegistry.documents);
    expect(historical.contexts).toEqual(oldRegistry.contexts);
    expect(
      await f.prisma.protocol.findUniqueOrThrow({
        where: { id: protocol.id },
        include: { findings: true },
      }),
    ).toEqual(protocol);
    expect(
      await f.prisma.extraction.findMany({
        where: { runId: firstRun, fileId: source.files[0]!.fileId },
        include: { evidence: true },
      }),
    ).toEqual(selected);
    expect(
      await f.prisma.file.count({ where: { objectId: source.objectId } }),
    ).toBe(3);
    expect(
      await f.prisma.parsingTask.count({
        where: { runId: secondRun, state: "succeeded", attempts: 0 },
      }),
    ).toBe(3);
  });
});
