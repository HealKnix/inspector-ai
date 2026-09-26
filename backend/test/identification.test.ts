import { connect } from "amqplib";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrivateStorageService } from "../src/infrastructure/storage/private-storage.service.js";
import { ClassificationJobsService } from "../src/modules/identification/classification-jobs.service.js";
import type { ClarificationBatch } from "../src/modules/identification/identification-contract.js";
import {
  createIdentificationFixture,
  type IdentificationFixture,
  type IdentificationRegistry,
} from "./helpers/identification-fixture.js";

let fixture: IdentificationFixture;
beforeAll(async () => {
  fixture = await createIdentificationFixture();
});
afterAll(async () => {
  await fixture?.close();
});

function clarification(
  registry: IdentificationRegistry,
  title = "Уточнённый собственный заголовок",
): ClarificationBatch {
  const document = registry.documents[0]!;
  return {
    request_id: randomUUID(),
    expected_run_id: registry.run_id,
    basis: "Проверено по собственному заголовку исходного документа",
    documents: [
      {
        document_id: document.document_id,
        expected_version: document.card_version,
        revisions: [
          {
            revision_id: document.revisions[0]!.revision_id,
            fields: { title },
          },
        ],
      },
    ],
  };
}

describe("identification snapshots and decisions (real PG, RabbitMQ and HTTP; synthetic parser artifacts)", () => {
  it("projects the new Run's explicit stage confirmation into the upload list without clearing source limitations", async () => {
    const machine = {
      schema_version: 1 as const,
      stage: "RD" as const,
      document_kind: null,
      method: "rules" as const,
      needs_review: true,
      reasons: ["partial_parse_requires_review"],
      evidence: [],
      candidates: [],
      versions: {
        classifier: "synthetic",
        rules: "synthetic",
        context: "synthetic",
        prompt: "synthetic",
        model: null,
      },
    };
    const source = await fixture.seed([
      { format: "PDF", classification: machine, text: "РАБОЧАЯ ДОКУМЕНТАЦИЯ" },
    ]);
    await fixture.identify(source);
    const before = await fixture.registry(source);
    const document = before.documents[0]!;
    const revision = document.revisions[0]!;
    const response = await fixture
      .apply(source, {
        request_id: randomUUID(),
        expected_run_id: before.run_id,
        basis: "Стадия сверена с титулом",
        documents: [
          {
            document_id: document.document_id,
            expected_version: document.card_version,
            revisions: [
              { revision_id: revision.revision_id, fields: { stage: "RD" } },
            ],
          },
        ],
      })
      .expect(202);
    const after = await fixture.registry(source);
    const listed = await request(fixture.server)
      .get(`/api/v1/objects/${source.objectId}/classification`)
      .set("Authorization", `Bearer ${fixture.inspector.token}`)
      .expect(200);
    const body = listed.body as {
      items: {
        run_id: string;
        result: unknown;
        review: unknown;
      }[];
    };
    const item = body.items[0]!;
    expect(item.run_id).toBe((response.body as { run_id: string }).run_id);
    expect(item.result).toEqual(machine);
    expect(item.review).toMatchObject({
      document_id: after.documents[0]!.document_id,
      resolved_input_hash: after.resolved_input_hash,
      confirmed_fields: ["stage"],
      fields: { stage: "RD" },
      needs_review: false,
      source_issues: ["partial_parse_requires_review"],
    });
    expect(after.documents[0]!.revisions[0]!.approval.confirmed).toBe(false);
    expect((await fixture.registry(source, before.run_id)).documents).toEqual(
      before.documents,
    );
    const task = await fixture.prisma.classificationTask.findFirstOrThrow({
      where: { artifact: { task: { runId: after.run_id } } },
      orderBy: { cycle: "desc" },
    });
    await fixture.prisma.classificationTask.create({
      data: {
        artifactId: task.artifactId,
        cycle: task.cycle + 1,
        fingerprint: fixture.app.get(ClassificationJobsService).fingerprint,
      },
    });
    const pending = await request(fixture.server)
      .get(`/api/v1/objects/${source.objectId}/classification`)
      .set("Authorization", `Bearer ${fixture.inspector.token}`)
      .expect(200);
    const pendingBody = pending.body as {
      active: boolean;
      review_active: boolean;
      items: { review: unknown }[];
    };
    expect(pendingBody.active).toBe(true);
    expect(pendingBody.review_active).toBe(true);
    expect(pendingBody.items[0]!.review).toBeNull();
  });

  it("records confirmation of unchanged visible fields without approving the revision or changing its reference", async () => {
    const source = await fixture.seed([
      {
        format: "PDF",
        blocks: [
          { text: "АОСР № 52 от 20.04.2026" },
          { text: "Область работ: оси 14–17/А–Ж" },
          { text: "Период работ: 20.04.2026 — 20.04.2026" },
        ],
      },
    ]);
    await fixture.identify(source);
    const before = await fixture.registry(source);
    const document = before.documents[0]!;
    const revision = document.revisions[0]!;
    expect(revision.fields.number).toBe("52");
    const fields = {
      number: revision.fields.number!,
      date: revision.fields.date!,
      scope: revision.fields.scope!,
      works_from: revision.fields.works_from!,
      works_to: revision.fields.works_to!,
    };
    const body: ClarificationBatch = {
      request_id: randomUUID(),
      expected_run_id: before.run_id,
      basis: "Подтверждаю указанные реквизиты по документу",
      documents: [
        {
          document_id: document.document_id,
          expected_version: document.card_version,
          revisions: [{ revision_id: revision.revision_id, fields }],
        },
      ],
    };
    const response = await fixture.apply(source, body).expect(202);
    const runId = (response.body as { run_id: string }).run_id;
    const after = await fixture.registry(source);
    const confirmed = after.documents[0]!.revisions[0]!;
    expect(after.run_id).toBe(runId);
    expect(after.run_id).not.toBe(before.run_id);
    expect(confirmed.fields).toEqual(revision.fields);
    expect(confirmed.approval).toEqual(revision.approval);
    expect(confirmed.approval.confirmed).toBe(false);
    expect(confirmed.reference_revision_id).toBe(
      revision.reference_revision_id,
    );
    expect(after.documents[0]!.card_version).toBeGreaterThan(
      document.card_version,
    );
    const decisions = await fixture.prisma.clarification.findMany({
      where: { runId },
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.actorId).toBe(fixture.inspector.id);
    expect(decisions[0]!.basis).toBe(body.basis);
    expect(decisions[0]!.patch).toEqual(body.documents[0]!.revisions[0]);
    const replay = await fixture.apply(source, body).expect(202);
    expect(replay.body).toMatchObject({ run_id: runId, replayed: true });
    expect(await fixture.prisma.clarification.count({ where: { runId } })).toBe(
      1,
    );
    expect((await fixture.registry(source, before.run_id)).documents).toEqual(
      before.documents,
    );
  });

  it("groups corrected PDF/XML, keeps source history, and routes canonical edits to both representations", async () => {
    const title = "Акт освидетельствования скрытых работ";
    const classification = {
      schema_version: 1 as const,
      stage: "ID" as const,
      kind_code: "AOSR",
      document_kind: title,
      method: "rules" as const,
      needs_review: false,
      reasons: [],
      candidates: [],
      evidence: [
        {
          page_number: 1,
          block_id: "p1:b0",
          quote: title,
          bbox: [0, 0, 1, 1] as [number, number, number, number],
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
    const source = await fixture.seed([
      {
        format: "PDF",
        classification,
        blocks: [
          { text: title },
          { text: "Область работ: оси 1–3" },
          { text: "Область работ: оси 4–6" },
        ],
      },
      {
        format: "XML",
        classification,
        blocks: [
          {
            text: title,
            path: "/{http://idActs/AOSR.xsd}aosr[1]/{http://idActs/AOSR.xsd}actInfo[1]/{http://types/CommonTypes.xsd}documentInfo[1]/{http://types/CommonTypes.xsd}name[1]/text()[1]",
          },
        ],
      },
    ]);
    await fixture.identify(source);
    const before = await fixture.registry(source);
    expect(before.documents).toHaveLength(2);
    expect(
      before.documents
        .flatMap((doc) => doc.revisions)
        .some((revision) => revision.blockers.includes("field_conflict:scope")),
    ).toBe(true);
    const body: ClarificationBatch = {
      request_id: randomUUID(),
      expected_run_id: source.runId,
      basis: "Сверены реквизиты и область обоих представлений",
      documents: before.documents.map((doc) => ({
        document_id: doc.document_id,
        expected_version: doc.card_version,
        revisions: doc.revisions.map((revision) => ({
          revision_id: revision.revision_id,
          fields: {
            number: "52",
            date: "2026-04-20",
            scope: "оси 1–3",
            works_from: "2026-04-20",
            works_to: "2026-04-21",
          },
        })),
      })),
    };
    await fixture.apply(source, body).expect(202);
    const merged = await fixture.registry(source);
    expect(merged.documents).toHaveLength(1);
    expect(merged.documents[0]!.revisions).toHaveLength(1);
    expect(merged.documents[0]!.revisions[0]!.representations).toHaveLength(2);
    expect(merged.documents[0]!.revisions[0]!.blockers).not.toContain(
      "field_conflict:scope",
    );
    expect(merged.document_aliases).toHaveLength(2);
    expect(merged.history).toHaveLength(2);
    const formerDocument = before.documents.find(
      (doc) => doc.document_id !== merged.documents[0]!.document_id,
    )!;
    const detail = await request(fixture.server)
      .get(
        `/api/v1/processes/${source.processId}/documents/${formerDocument.document_id}`,
      )
      .auth(fixture.inspector.token, { type: "bearer" })
      .expect(200);
    const detailBody = detail.body as IdentificationRegistry & {
      document: IdentificationRegistry["documents"][number];
    };
    expect(detailBody.document.document_id).toBe(
      merged.documents[0]!.document_id,
    );
    expect(detailBody.history).toHaveLength(2);
    await fixture
      .apply(source, clarification(merged, "Подтверждённое общее наименование"))
      .expect(202);
    const corrected = await fixture.registry(source);
    expect(corrected.documents).toHaveLength(1);
    expect(corrected.documents[0]!.revisions[0]!.representations).toHaveLength(
      2,
    );
    expect(corrected.documents[0]!.revisions[0]!.fields.title).toBe(
      "Подтверждённое общее наименование",
    );
    expect(corrected.history).toHaveLength(4);
    expect(
      await fixture.prisma.clarification.count({
        where: { runId: corrected.run_id },
      }),
    ).toBe(2);
    expect(
      await fixture.prisma.document.count({
        where: { processId: source.processId },
      }),
    ).toBe(2);
    const historical = await fixture.registry(source, source.runId);
    expect(historical.documents).toEqual(before.documents);
    expect(historical.history).toEqual([]);
  });

  it("recovers initial artifacts once, consumes duplicate deliveries and freezes provenance", async () => {
    const source = await fixture.seed();
    await fixture.jobs.recover();
    const task = await fixture.prisma.identificationTask.findFirstOrThrow({
      where: { runId: source.runId },
    });
    const event = await fixture.prisma.outbox.findFirstOrThrow({
      where: {
        eventType: "identification.requested",
        payload: { path: ["task_id"], equals: task.id },
      },
    });
    const connection = await connect(fixture.brokerUrl);
    const channel = await connection.createConfirmChannel();
    try {
      const queue = await channel.assertQueue("", { exclusive: true });
      channel.sendToQueue(
        queue.queue,
        Buffer.from(JSON.stringify(event.payload)),
        { persistent: true },
      );
      await channel.waitForConfirms();
      const delivery = await channel.get(queue.queue, { noAck: false });
      if (!delivery) throw new Error("Missing test delivery");
      await fixture.jobs.execute(task.id);
      channel.nack(delivery, false, true);
      const duplicate = await channel.get(queue.queue, { noAck: false });
      if (!duplicate) throw new Error("Missing duplicate test delivery");
      await fixture.jobs.execute(task.id);
      channel.ack(duplicate);
    } finally {
      await connection.close();
    }
    await fixture.jobs.recover();
    const registry = await fixture.registry(source);
    expect(registry.documents).toHaveLength(1);
    expect(registry.allowed_actions.apply).toBe(true);
    expect(registry.documents[0]!.revisions[0]!.approval.confirmed).toBe(false);
    expect(
      await fixture.prisma.resolvedInputSnapshot.count({
        where: { runId: source.runId },
      }),
    ).toBe(1);
    const saved = await fixture.prisma.resolvedInputSnapshot.findFirstOrThrow({
      where: { runId: source.runId },
    });
    await expect(
      fixture.prisma.resolvedInputSnapshot.update({
        where: { id: saved.id },
        data: { snapshot: {} },
      }),
    ).rejects.toThrow();
    const part = await fixture.prisma.fileDocumentPart.findFirstOrThrow({
      where: { runId: source.runId },
    });
    await expect(
      fixture.prisma.fileDocumentPart.update({
        where: { id: part.id },
        data: { machine: {} },
      }),
    ).rejects.toThrow();
  });

  it("applies one new Run under concurrent edits, replays receipts and reuses exact parser artifacts", async () => {
    const source = await fixture.seed();
    await fixture.identify(source);
    const before = await fixture.registry(source);
    const original =
      await fixture.prisma.resolvedInputSnapshot.findFirstOrThrow({
        where: { runId: source.runId },
      });
    const input = clarification(before);
    const other = clarification(before, "Конкурентное другое уточнение");
    const responses = await Promise.all([
      fixture.apply(source, input),
      fixture.apply(source, other),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      202, 409,
    ]);
    const winner = responses[0].status === 202 ? input : other;
    const first = responses.find((response) => response.status === 202)!;
    const replay = await fixture.apply(source, winner);
    expect(replay.status).toBe(202);
    const replayBody = replay.body as { run_id: string; replayed: boolean };
    expect(replayBody.run_id).toBe((first.body as { run_id: string }).run_id);
    expect(replayBody.replayed).toBe(true);
    const conflict = await fixture.apply(source, {
      ...winner,
      basis: "Другое основание с тем же ключом",
    });
    expect(conflict.status).toBe(409);
    expect(
      await fixture.prisma.run.count({
        where: { processId: source.processId },
      }),
    ).toBe(2);
    const after = await fixture.registry(source);
    expect(after.run_id).not.toBe(before.run_id);
    expect(after.documents[0]!.revisions[0]!.fields.title).toBe(
      winner.documents[0]!.revisions[0]!.fields!.title,
    );
    const oldArtifact = await fixture.prisma.parseArtifact.findUniqueOrThrow({
      where: { id: source.files[0]!.artifactId },
    });
    const newArtifact = await fixture.prisma.parseArtifact.findFirstOrThrow({
      where: { task: { runId: after.run_id } },
    });
    expect(newArtifact.id).not.toBe(oldArtifact.id);
    expect(newArtifact.storageKey).toBe(oldArtifact.storageKey);
    expect(newArtifact.pipelineFingerprint).toBe(
      oldArtifact.pipelineFingerprint,
    );
    expect(
      after.documents[0]!.revisions[0]!.representations[0]!.artifact_id,
    ).toBe(newArtifact.id);
    expect(
      await fixture.prisma.resolvedInputSnapshot.findUniqueOrThrow({
        where: { id: original.id },
      }),
    ).toEqual(original);
    expect((await fixture.registry(source, source.runId)).documents).toEqual(
      before.documents,
    );
    const decision = await fixture.prisma.clarification.findFirstOrThrow({
      where: { runId: after.run_id },
    });
    expect(decision.cardVersion).toBe(winner.documents[0]!.expected_version);
    await expect(
      fixture.prisma.clarification.update({
        where: { id: decision.id },
        data: { basis: "Перезапись" },
      }),
    ).rejects.toThrow();
    expect(
      await fixture.prisma.job.count({
        where: { runId: after.run_id, kind: "document.parsing" },
      }),
    ).toBe(1);
  });

  it("rejects outsider/admin, unversioned legacy edits, active processing and finalized changes", async () => {
    const source = await fixture.seed();
    await fixture.identify(source);
    const input = clarification(await fixture.registry(source));
    expect((await fixture.apply(source, input, fixture.outsider)).status).toBe(
      403,
    );
    expect((await fixture.apply(source, input, fixture.admin)).status).toBe(
      403,
    );
    const old = await request(fixture.server)
      .post(
        `/api/v1/objects/${source.objectId}/files/${source.files[0]!.fileId}/classification/resolve`,
      )
      .auth(fixture.inspector.token, { type: "bearer" })
      .send({ kind_code: "AOSR" });
    expect(old.status).toBe(400);
    await fixture.prisma.process.update({
      where: { id: source.processId },
      data: { status: "PARSING" },
    });
    expect((await fixture.apply(source, input)).status).toBe(409);
    await fixture.prisma.process.update({
      where: { id: source.processId },
      data: { status: "FINALIZED" },
    });
    expect((await fixture.apply(source, input)).status).toBe(409);
    await fixture.prisma.process.update({
      where: { id: source.processId },
      data: { status: "PENDING" },
    });
    const active = await fixture.prisma.extractionTask.create({
      data: {
        artifactId: source.files[0]!.artifactId,
        cycle: 1,
        fingerprint: "e".repeat(64),
        state: "queued",
      },
    });
    expect((await fixture.apply(source, input)).status).toBe(409);
    await fixture.prisma.extractionTask.update({
      where: { id: active.id },
      data: { state: "failed" },
    });
    expect(
      await fixture.prisma.clarification.count({
        where: { processId: source.processId },
      }),
    ).toBe(0);
  });

  it("preserves an inspector override after a real machine reclassification and source re-identification", async () => {
    const source = await fixture.seed([
      { format: "PDF", text: "АКТ ОСВИДЕТЕЛЬСТВОВАНИЯ СКРЫТЫХ РАБОТ №52" },
    ]);
    await fixture.identify(source);
    const input = clarification(
      await fixture.registry(source),
      "Инспекторское уточнение",
    );
    const applied = await fixture.apply(source, input);
    expect(applied.status).toBe(202);
    const runId = (applied.body as { run_id: string }).run_id;
    const beforeRetry = await fixture.registry(source);
    const originalClassification =
      await fixture.prisma.classificationTask.findFirstOrThrow({
        where: { artifact: { task: { runId: source.runId } } },
      });
    const retry = await request(fixture.server)
      .post(
        `/api/v1/objects/${source.objectId}/files/${source.files[0]!.fileId}/classification/retry`,
      )
      .auth(fixture.inspector.token, { type: "bearer" })
      .send({ request_id: randomUUID() });
    expect(retry.status).toBe(202);
    await fixture.app
      .get(ClassificationJobsService)
      .execute((retry.body as { task_id: string }).task_id);
    await fixture.identify({ runId });
    const after = await fixture.registry(source);
    expect(after.documents[0]!.revisions[0]!.fields.title).toBe(
      "Инспекторское уточнение",
    );
    expect(
      await fixture.prisma.classificationTask.findUniqueOrThrow({
        where: { id: originalClassification.id },
      }),
    ).toEqual(originalClassification);
    expect(
      await fixture.prisma.resolvedInputSnapshot.count({ where: { runId } }),
    ).toBe(2);
    expect(after.snapshot_versions.map((snapshot) => snapshot.version)).toEqual(
      [2, 1],
    );
    const historical = await fixture.registry(
      source,
      runId,
      beforeRetry.resolved_input_hash!,
    );
    expect(historical.current).toBe(false);
    expect(historical.active).toBe(false);
    expect(historical.allowed_actions.apply).toBe(false);
    expect(historical.documents).toEqual(beforeRetry.documents);
    expect(historical.history).toEqual(beforeRetry.history);
    const base = `/api/v1/processes/${source.processId}/documents`;
    const selectedDocument = beforeRetry.documents[0]!;
    const detail = await request(fixture.server)
      .get(`${base}/${selectedDocument.document_id}`)
      .query({
        run_id: runId,
        resolved_input_hash: beforeRetry.resolved_input_hash,
      })
      .auth(fixture.inspector.token, { type: "bearer" })
      .expect(200);
    expect((detail.body as { document: unknown }).document).toEqual(
      selectedDocument,
    );
    await request(fixture.server)
      .get(base)
      .query({ resolved_input_hash: "invalid" })
      .auth(fixture.inspector.token, { type: "bearer" })
      .expect(400);
    await request(fixture.server)
      .get(base)
      .query({ resolved_input_hash: "f".repeat(64) })
      .auth(fixture.inspector.token, { type: "bearer" })
      .expect(404);
  });

  it("rejects an unchanged card's stale editor after another source changes the same Run selection", async () => {
    const source = await fixture.seed([{ format: "PDF" }, { format: "XML" }]);
    await fixture.identify(source);
    const before = await fixture.registry(source);
    const oldEdit = clarification(before);
    const editedFile =
      before.documents[0]!.revisions[0]!.representations[0]!.file_id;
    const otherFile = source.files.find((file) => file.fileId !== editedFile)!;
    const retry = await request(fixture.server)
      .post(
        `/api/v1/objects/${source.objectId}/files/${otherFile.fileId}/classification/retry`,
      )
      .auth(fixture.inspector.token, { type: "bearer" })
      .send({ request_id: randomUUID() })
      .expect(202);
    await fixture.app
      .get(ClassificationJobsService)
      .execute((retry.body as { task_id: string }).task_id);
    await fixture.identify(source);
    const refreshed = await fixture.registry(source);
    expect(refreshed.run_id).toBe(before.run_id);
    expect(refreshed.resolved_input_hash).not.toBe(before.resolved_input_hash);
    const untouched = refreshed.documents.find(
      (doc) => doc.document_id === oldEdit.documents[0]!.document_id,
    )!;
    expect(untouched.card_version).toBeGreaterThan(
      oldEdit.documents[0]!.expected_version,
    );
    const rejected = await fixture.apply(source, oldEdit).expect(409);
    expect((rejected.body as { code: string }).code).toBe(
      "identification_version_conflict",
    );
    expect(
      await fixture.prisma.clarification.count({
        where: { processId: source.processId },
      }),
    ).toBe(0);
  });

  it.each(["artifact", "image"] as const)(
    "sends a compatible but corrupt %s cache entry through ordinary background PAR",
    async (kind) => {
      const source = await fixture.seed();
      await fixture.identify(source);
      const before = await fixture.registry(source);
      const stored = await fixture.prisma.parseArtifact.findUniqueOrThrow({
        where: { id: source.files[0]!.artifactId },
      });
      const parsed = await fixture.artifacts.read(
        stored.storageKey,
        stored.artifactSha256,
        stored.sourceSha256,
        stored.pipelineFingerprint,
      );
      const key =
        kind === "artifact" ? stored.storageKey : parsed.pages[0]!.image_key;
      await writeFile(
        fixture.app.get(PrivateStorageService).path("derived", key),
        "corrupt synthetic cache bytes",
      );
      const response = await fixture
        .apply(source, clarification(before))
        .expect(202);
      const body = response.body as {
        run_id: string;
        resolved_input_hash: string | null;
      };
      expect(body.resolved_input_hash).toBeNull();
      expect(
        await fixture.prisma.parseArtifact.count({
          where: { task: { runId: body.run_id } },
        }),
      ).toBe(0);
      expect(
        await fixture.prisma.resolvedInputSnapshot.count({
          where: { runId: body.run_id },
        }),
      ).toBe(0);
      expect(
        await fixture.prisma.job.count({
          where: { runId: body.run_id, kind: "document.parsing" },
        }),
      ).toBe(1);
      expect(
        await fixture.prisma.clarification.count({
          where: { runId: body.run_id },
        }),
      ).toBe(1);
      expect((await fixture.registry(source)).active).toBe(true);
    },
  );

  it("does not reuse an artifact from a different current parser configuration", async () => {
    const source = await fixture.seed();
    await fixture.identify(source);
    fixture.setParserFingerprint("c".repeat(64));
    try {
      const response = await fixture.apply(
        source,
        clarification(await fixture.registry(source)),
      );
      expect(response.status).toBe(202);
      const responseBody = response.body as {
        run_id: string;
        resolved_input_hash: string | null;
      };
      expect(responseBody.resolved_input_hash).toBeNull();
      expect(
        await fixture.prisma.parseArtifact.count({
          where: { task: { runId: responseBody.run_id } },
        }),
      ).toBe(0);
      const current = await fixture.registry(source);
      expect(current.active).toBe(true);
      expect(current.allowed_actions.apply).toBe(false);
      expect(
        await fixture.prisma.job.count({
          where: {
            runId: responseBody.run_id,
            kind: "document.parsing",
          },
        }),
      ).toBe(1);
    } finally {
      fixture.setParserFingerprint(fixture.parserFingerprint);
    }
  });

  it("fences a worker when its Run is superseded during the artifact read", async () => {
    const source = await fixture.seed();
    await fixture.jobs.recover();
    const task = await fixture.prisma.identificationTask.findFirstOrThrow({
      where: { runId: source.runId },
    });
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const read = fixture.artifacts.read.bind(fixture.artifacts);
    const spy = vi
      .spyOn(fixture.artifacts, "read")
      .mockImplementationOnce(async (...args) => {
        entered();
        await held;
        return read(...args);
      });
    const running = fixture.jobs.execute(task.id);
    await started;
    await fixture.prisma.process.update({
      where: { id: source.processId },
      data: { version: 2 },
    });
    release();
    await running;
    spy.mockRestore();
    expect(
      await fixture.prisma.resolvedInputSnapshot.count({
        where: { runId: source.runId },
      }),
    ).toBe(0);
    expect(
      (
        await fixture.prisma.identificationTask.findUniqueOrThrow({
          where: { id: task.id },
        })
      ).errorCode,
    ).toBe("identification_superseded");
  });
});
