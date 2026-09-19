import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { connect } from "amqplib";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { resolve } from "node:path";
import pg from "pg";
import "reflect-metadata";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import { PrivateStorageService } from "../src/infrastructure/storage/private-storage.service.js";
import { AuthService } from "../src/modules/auth/auth.service.js";
import { canonicalJson } from "../src/modules/documents/canonical-json.js";
import { ClassificationJobsService } from "../src/modules/identification/classification-jobs.service.js";
import { ObjectAccessService } from "../src/modules/objects/object-access.service.js";
import { ArtifactStorageService } from "../src/modules/parsing/artifact-storage.service.js";
import type { ParseArtifactData } from "../src/modules/parsing/parsing-contract.js";

// Synthetic parser artifacts isolate classification durability and access from
// OCR quality. PostgreSQL, RabbitMQ, artifact storage and HTTP are real; no
// documents or prompts are sent to an external provider in this suite.
const dbName = "classification_" + randomUUID().replaceAll("-", "");
const databaseUrl =
  "postgresql://postgres:ingestion-test-only@127.0.0.1:25432/" + dbName;
const brokerUrl = "amqp://guest:guest@127.0.0.1:25672";
const root = resolve("../.test-output/classification", dbName);
const fingerprint = "d".repeat(64);
const title = "ПРОЕКТНАЯ ДОКУМЕНТАЦИЯ";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j/qkAAAAASUVORK5CYII=",
  "base64",
);
let app: INestApplication;
let server: Server;
let prisma: PrismaService;
let storage: PrivateStorageService;
let artifacts: ArtifactStorageService;
let jobs: ClassificationJobsService;
let inspector: { id: string; token: string };
let outsider: { id: string; token: string };
let admin: { id: string; token: string };

function digest(data: Buffer | string) {
  return createHash("sha256").update(data).digest("hex");
}

async function account(role: "INSPECTOR" | "ADMINISTRATOR") {
  const session = await app
    .get(AuthService)
    .register("cls-" + randomUUID().slice(0, 8), "Synthetic-password-123!");
  await prisma.user.update({ where: { id: session.user.id }, data: { role } });
  return { id: session.user.id, token: session.accessToken };
}

interface Source {
  objectId: string;
  processId: string;
  runId: string;
  fileId: string;
  sourceHash: string;
}

async function parsedArtifact(source: Source, cycle = 1, text = title) {
  const task = await prisma.parsingTask.create({
    data: {
      objectId: source.objectId,
      processId: source.processId,
      runId: source.runId,
      fileId: source.fileId,
      cycle,
      state: "succeeded",
      attempts: 1,
      pipelineFingerprint: fingerprint,
      pagesCompleted: 1,
      pagesTotal: 1,
      completedAt: new Date(),
    },
  });
  const imageKey = randomUUID();
  await writeFile(resolve(root, "derived", imageKey), png);
  const artifact: ParseArtifactData = {
    schema_version: 1,
    source_sha256: source.sourceHash,
    pipeline_fingerprint: fingerprint,
    versions: { parser: "synthetic-classification-v1" },
    raw_text: text,
    normalized_text: text,
    quality: "OK",
    reasons: [],
    coverage: { total_pages: 1, readable_pages: 1, unreadable_pages: 0 },
    pages: [
      {
        page_number: 1,
        sheet_label: null,
        width: 1,
        height: 1,
        image_key: imageKey,
        image_sha256: digest(png),
        quality: "OK",
        reasons: [],
        transform: {
          renderer: "synthetic",
          coordinate_space: "visible-page-normalized",
          structural_mapping: true,
          font_sha256: fingerprint,
          layout: "synthetic",
          render_width: 1,
          render_height: 1,
        },
        blocks: [
          {
            id: "p1:b0",
            order: 0,
            kind: "text",
            raw_text: text,
            normalized_text: text,
            bbox: [0, 0, 1, 1],
            confidence: null,
            source: "structured",
            structural_path: "/synthetic/title",
            table_id: null,
            row: null,
            column: null,
            row_span: null,
            column_span: null,
          },
        ],
      },
    ],
  };
  return prisma.parseArtifact.create({
    data: {
      taskId: task.id,
      sourceSha256: source.sourceHash,
      pipelineFingerprint: fingerprint,
      ...(await artifacts.write(artifact)),
      quality: "OK",
      reasons: [],
      pagesTotal: 1,
    },
  });
}

async function seed(text = title) {
  const object = await prisma.constructionObject.create({
    data: {
      name: "Синтетический объект классификации",
      createdBy: inspector.id,
    },
  });
  await prisma.objectAccess.create({
    data: {
      objectId: object.id,
      userId: inspector.id,
      grantedBy: inspector.id,
    },
  });
  const process = await prisma.process.create({
    data: { objectId: object.id },
  });
  const runId = randomUUID();
  const fileId = randomUUID();
  const content = Buffer.from(`<synthetic id="${randomUUID()}"/>`);
  const sourceHash = digest(content);
  const temporary = await storage.temporary();
  await temporary.handle.writeFile(content);
  await temporary.handle.close();
  const storageKey = await storage.publish(temporary.key);
  await storage.discard(temporary.key);
  const manifest = {
    schema_version: 1,
    object_id: object.id,
    process_id: process.id,
    run_id: runId,
    files: [{ file_id: fileId, file_hash: sourceHash }],
    versions: {},
  };
  await prisma.run.create({
    data: {
      id: runId,
      objectId: object.id,
      processId: process.id,
      version: 1,
      inputManifest: manifest,
      inputManifestHash: digest(canonicalJson(manifest)),
    },
  });
  await prisma.file.create({
    data: {
      id: fileId,
      objectId: object.id,
      processId: process.id,
      runId,
      originalName: "synthetic.docx",
      format: "DOCX",
      size: content.length,
      sha256: sourceHash,
      storageKey,
      uploadedBy: inspector.id,
    },
  });
  await prisma.runInput.create({
    data: { runId, fileId, objectId: object.id, processId: process.id },
  });
  const source = {
    objectId: object.id,
    processId: process.id,
    runId,
    fileId,
    sourceHash,
  };
  const artifact = await parsedArtifact(source, 1, text);
  return { ...source, artifactId: artifact.id, parserTaskId: artifact.taskId };
}

async function scheduled(artifactId: string) {
  await jobs.recover();
  return prisma.classificationTask.findFirstOrThrow({
    where: { artifactId },
    orderBy: { cycle: "desc" },
  });
}

function listing(source: Source, user = inspector) {
  return request(server)
    .get(`/api/v1/objects/${source.objectId}/classification`)
    .auth(user.token, { type: "bearer" });
}

function retry(source: Source, requestId: string, user = inspector) {
  return request(server)
    .post(
      `/api/v1/objects/${source.objectId}/files/${source.fileId}/classification/retry`,
    )
    .auth(user.token, { type: "bearer" })
    .send({ request_id: requestId });
}

async function nextRun(source: Source) {
  const runId = randomUUID();
  const manifest = {
    schema_version: 1,
    object_id: source.objectId,
    process_id: source.processId,
    run_id: runId,
    files: [{ file_id: source.fileId, file_hash: source.sourceHash }],
    versions: {},
  };
  await prisma.$transaction(async (tx) => {
    await tx.process.update({
      where: { id: source.processId },
      data: { version: 2 },
    });
    await tx.run.create({
      data: {
        id: runId,
        objectId: source.objectId,
        processId: source.processId,
        version: 2,
        inputManifest: manifest,
        inputManifestHash: digest(canonicalJson(manifest)),
      },
    });
    await tx.runInput.create({
      data: {
        runId,
        fileId: source.fileId,
        objectId: source.objectId,
        processId: source.processId,
      },
    });
  });
  return { ...source, runId };
}

function holdArtifactRead() {
  let release!: () => void;
  let started!: () => void;
  const held = new Promise<void>((done) => {
    release = done;
  });
  const entered = new Promise<void>((done) => {
    started = done;
  });
  const read = artifacts.read.bind(artifacts);
  const spy = vi
    .spyOn(artifacts, "read")
    .mockImplementationOnce(async (...args) => {
      started();
      await held;
      return read(...args);
    });
  return { release, entered, restore: () => spy.mockRestore() };
}

beforeAll(async () => {
  const management = new pg.Client({
    connectionString:
      "postgresql://postgres:ingestion-test-only@127.0.0.1:25432/ingestion_test",
  });
  await management.connect();
  await management.query('CREATE DATABASE "' + dbName + '"');
  await management.end();
  await mkdir(resolve(root, "derived"), { recursive: true });
  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    STORAGE_ROOT: root,
    JWT_SECRET: "synthetic-access-secret-at-least-32-characters",
    JWT_REFRESH_SECRET: "synthetic-refresh-secret-at-least-32-characters",
    NODE_ENV: "test",
    PARSER_URL: "http://127.0.0.1:1",
    PARSER_TOKEN: "p".repeat(32),
    REDIS_URL: "redis://127.0.0.1:1",
    RABBITMQ_URL: brokerUrl,
    CLASSIFICATION_LLM_ENABLED: "false",
  });
  execFileSync(
    process.execPath,
    [resolve("../node_modules/prisma/build/index.js"), "migrate", "deploy"],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: "pipe",
    },
  );
  const { AppModule } = await import("../src/app.module.js");
  app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  server = app.getHttpServer() as Server;
  prisma = app.get(PrismaService);
  storage = app.get(PrivateStorageService);
  artifacts = app.get(ArtifactStorageService);
  jobs = app.get(ClassificationJobsService);
  inspector = await account("INSPECTOR");
  outsider = await account("INSPECTOR");
  admin = await account("ADMINISTRATOR");
});

afterAll(async () => {
  await app?.close();
  await writeFile(resolve(root, "database.txt"), dbName);
});

describe("classification durability and access (real PG/broker/storage, synthetic artifacts)", () => {
  it("backfills parser artifacts once and publishes one result through duplicate RabbitMQ delivery", async () => {
    const source = await seed();
    const task = await scheduled(source.artifactId);
    await jobs.recover();
    expect(
      await prisma.classificationTask.count({
        where: { artifactId: source.artifactId },
      }),
    ).toBe(1);
    const outbox = await prisma.outbox.findMany({
      where: { payload: { path: ["task_id"], equals: task.id } },
    });
    expect(outbox).toHaveLength(1);
    expect(task.dispatchedAt).not.toBeNull();
    const connection = await connect(brokerUrl);
    const channel = await connection.createConfirmChannel();
    try {
      const queue = await channel.assertQueue("", { exclusive: true });
      channel.sendToQueue(
        queue.queue,
        Buffer.from(JSON.stringify(outbox[0]!.payload)),
        { persistent: true },
      );
      await channel.waitForConfirms();
      const delivery = await channel.get(queue.queue, { noAck: false });
      if (!delivery) throw new Error("Expected classification delivery");
      const payload = JSON.parse(delivery.content.toString()) as {
        task_id: string;
      };
      expect(payload.task_id).toBe(task.id);
      await jobs.execute(payload.task_id);
      channel.nack(delivery, false, true);
      const duplicate = await channel.get(queue.queue, { noAck: false });
      if (!duplicate) throw new Error("Expected classification redelivery");
      await jobs.execute(
        (JSON.parse(duplicate.content.toString()) as { task_id: string })
          .task_id,
      );
      channel.ack(duplicate);
    } finally {
      await connection.close();
    }
    const saved = await prisma.classificationTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    expect(saved).toMatchObject({ state: "succeeded", attempts: 1 });
    expect(saved.result).toMatchObject({
      stage: "PD",
      method: "rules",
      needs_review: false,
    });
    expect(saved.result).toMatchObject({
      evidence: [
        expect.objectContaining({
          page_number: 1,
          block_id: "p1:b0",
          quote: title,
        }),
      ],
    });
    expect(
      await prisma.parsingTask.findUniqueOrThrow({
        where: { id: source.parserTaskId },
      }),
    ).toMatchObject({ cycle: 1, attempts: 1 });
    expect(
      (
        await prisma.process.findUniqueOrThrow({
          where: { id: source.processId },
        })
      ).status,
    ).toBe("PENDING");
    const response = await listing(source).expect(200);
    expect(response.body).toMatchObject({
      active: false,
      items: [
        {
          file_id: source.fileId,
          artifact_id: source.artifactId,
          task_id: task.id,
          result: { stage: "PD" },
        },
      ],
    });
    expect(
      await prisma.outbox.count({
        where: {
          eventType: "classification.succeeded",
          payload: { path: ["task_id"], equals: task.id },
        },
      }),
    ).toBe(1);
  });

  it("denies unassigned inspectors and administrators for both read and retry", async () => {
    const source = await seed();
    const task = await scheduled(source.artifactId);
    await jobs.execute(task.id);
    for (const user of [outsider, admin]) {
      await listing(source, user).expect(403);
      await retry(source, randomUUID(), user).expect(403);
    }
    await request(server)
      .get(`/api/v1/objects/${source.objectId}/classification`)
      .expect(401);
    expect(
      await prisma.classificationTask.count({
        where: { artifactId: source.artifactId },
      }),
    ).toBe(1);
  });

  it("retries classification idempotently without reparsing or overwriting the previous result", async () => {
    const source = await seed("Синтетический документ без признаков стадии");
    const original = await scheduled(source.artifactId);
    await jobs.execute(original.id);
    const previous = await prisma.classificationTask.findUniqueOrThrow({
      where: { id: original.id },
    });
    expect(previous.result).toMatchObject({ stage: null, needs_review: true });
    const requestId = randomUUID();
    const responses = await Promise.all([
      retry(source, requestId),
      retry(source, requestId),
    ]);
    expect(responses[0].status).toBe(202);
    expect(responses[1].status).toBe(202);
    expect(responses[0].body).toEqual(responses[1].body);
    const tasks = await prisma.classificationTask.findMany({
      where: { artifactId: source.artifactId },
      orderBy: { cycle: "asc" },
    });
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({
      id: original.id,
      result: previous.result,
    });
    expect(tasks[1]).toMatchObject({
      cycle: 2,
      state: "queued",
      attempts: 0,
      result: null,
    });
    expect((await listing(source).expect(200)).body).toMatchObject({
      active: true,
      items: [{ task_id: tasks[1]!.id, result: null }],
    });
    expect(
      await prisma.parsingTask.count({
        where: { runId: source.runId, fileId: source.fileId },
      }),
    ).toBe(1);
    await jobs.execute(tasks[1]!.id);
    await retry(source, requestId).expect(202);
    expect(
      await prisma.classificationTask.count({
        where: { artifactId: source.artifactId },
      }),
    ).toBe(2);
  });

  it("does not publish a worker result after a newer Run replaces its inputs", async () => {
    const source = await seed();
    const task = await scheduled(source.artifactId);
    const held = holdArtifactRead();
    const execution = jobs.execute(task.id);
    try {
      await held.entered;
      const current = await nextRun(source);
      const artifact = await parsedArtifact(current);
      expect((await listing(current).expect(200)).body).toMatchObject({
        items: [
          { run_id: current.runId, artifact_id: artifact.id, result: null },
        ],
      });
      held.release();
      await execution;
      expect(
        (
          await prisma.classificationTask.findUniqueOrThrow({
            where: { id: task.id },
          })
        ).result,
      ).toBeNull();
      const next = await scheduled(artifact.id);
      await jobs.execute(next.id);
      expect(
        (
          await prisma.classificationTask.findUniqueOrThrow({
            where: { id: next.id },
          })
        ).result,
      ).toMatchObject({ stage: "PD" });
      expect((await listing(current).expect(200)).body).toMatchObject({
        items: [
          { run_id: current.runId, task_id: next.id, result: { stage: "PD" } },
        ],
      });
    } finally {
      held.release();
      await execution;
      held.restore();
    }
  });

  it("hides a previously saved classification while the current parser cycle or Run has no artifact", async () => {
    const source = await seed();
    const task = await scheduled(source.artifactId);
    await jobs.execute(task.id);
    const previous = await prisma.classificationTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    await prisma.parsingTask.create({
      data: {
        objectId: source.objectId,
        processId: source.processId,
        runId: source.runId,
        fileId: source.fileId,
        cycle: 2,
      },
    });
    expect((await listing(source).expect(200)).body).toMatchObject({
      items: [],
    });
    const current = await nextRun(source);
    expect((await listing(current).expect(200)).body).toMatchObject({
      items: [],
    });
    await jobs.recover();
    expect(
      await prisma.classificationTask.findUniqueOrThrow({
        where: { id: task.id },
      }),
    ).toEqual(previous);
    expect(
      await prisma.classificationTask.count({
        where: { artifactId: source.artifactId },
      }),
    ).toBe(1);
  });

  it("rejects a stale worker after a newer parser cycle and preserves the old artifact", async () => {
    const source = await seed();
    const task = await scheduled(source.artifactId);
    const held = holdArtifactRead();
    const execution = jobs.execute(task.id);
    try {
      await held.entered;
      const artifact = await parsedArtifact(source, 2, "РАБОЧАЯ ДОКУМЕНТАЦИЯ");
      expect((await listing(source).expect(200)).body).toMatchObject({
        items: [{ artifact_id: artifact.id, result: null }],
      });
      held.release();
      await execution;
      expect(
        (
          await prisma.classificationTask.findUniqueOrThrow({
            where: { id: task.id },
          })
        ).result,
      ).toBeNull();
      const next = await scheduled(artifact.id);
      await jobs.execute(next.id);
      expect(
        (
          await prisma.classificationTask.findUniqueOrThrow({
            where: { id: next.id },
          })
        ).result,
      ).toMatchObject({ stage: "RD" });
      expect(
        await prisma.parseArtifact.count({ where: { id: source.artifactId } }),
      ).toBe(1);
      expect((await listing(source).expect(200)).body).toMatchObject({
        items: [
          {
            artifact_id: artifact.id,
            task_id: next.id,
            result: { stage: "RD" },
          },
        ],
      });
    } finally {
      held.release();
      await execution;
      held.restore();
    }
  });

  it("recovers an expired lease and prevents the old worker from replacing the new result", async () => {
    const source = await seed();
    const task = await scheduled(source.artifactId);
    const held = holdArtifactRead();
    const execution = jobs.execute(task.id);
    try {
      await held.entered;
      const owner = await prisma.classificationTask.findUniqueOrThrow({
        where: { id: task.id },
      });
      expect(owner.leaseToken).not.toBeNull();
      await prisma.classificationTask.update({
        where: { id: task.id },
        data: { leaseUntil: new Date(0) },
      });
      await jobs.recover();
      const recovered = await prisma.classificationTask.findUniqueOrThrow({
        where: { id: task.id },
      });
      expect(recovered).toMatchObject({
        state: "queued",
        attempts: 1,
        leaseToken: null,
      });
      await prisma.classificationTask.update({
        where: { id: task.id },
        data: { availableAt: new Date(0) },
      });
      await jobs.execute(task.id);
      const saved = await prisma.classificationTask.findUniqueOrThrow({
        where: { id: task.id },
      });
      expect(saved).toMatchObject({ state: "succeeded", attempts: 2 });
      expect(saved.result).toMatchObject({ stage: "PD" });
      held.release();
      await execution;
      expect(
        await prisma.classificationTask.findUniqueOrThrow({
          where: { id: task.id },
        }),
      ).toEqual(saved);
    } finally {
      held.release();
      await execution;
      held.restore();
    }
  });

  it("ends automatic recovery after the third failed execution instead of resetting attempts", async () => {
    const source = await seed();
    const task = await scheduled(source.artifactId);
    await prisma.classificationTask.update({
      where: { id: task.id },
      data: {
        state: "processing",
        attempts: 3,
        leaseToken: randomUUID(),
        leaseUntil: new Date(0),
      },
    });
    await jobs.recover();
    expect(
      await prisma.classificationTask.findUniqueOrThrow({
        where: { id: task.id },
      }),
    ).toMatchObject({
      state: "failed",
      attempts: 3,
      result: null,
      leaseToken: null,
      errorCode: "classification_lease_expired",
    });
    await jobs.recover();
    await jobs.execute(task.id);
    expect(
      await prisma.classificationTask.count({
        where: { artifactId: source.artifactId },
      }),
    ).toBe(1);
    expect(
      await prisma.outbox.count({
        where: {
          eventType: "classification.failed",
          payload: { path: ["task_id"], equals: task.id },
        },
      }),
    ).toBe(1);
    expect((await listing(source).expect(200)).body).toMatchObject({
      active: false,
      items: [
        { task_id: task.id, state: "failed", can_retry: true, result: null },
      ],
    });
  });

  it("does not let a differently configured worker fail tasks or create cycles and permits explicit retry of a mismatched queued task", async () => {
    const source = await seed();
    const otherWorker = new ClassificationJobsService(
      prisma,
      app.get(ObjectAccessService),
      artifacts,
      new ConfigService({
        CLASSIFICATION_LLM_ENABLED: false,
        CLASSIFICATION_LLM_MODEL: "synthetic/different-configuration",
      }),
    );
    expect(otherWorker.fingerprint).not.toBe(jobs.fingerprint);
    await otherWorker.recover();
    const original = await prisma.classificationTask.findFirstOrThrow({
      where: { artifactId: source.artifactId },
    });
    expect(original).toMatchObject({
      fingerprint: otherWorker.fingerprint,
      state: "queued",
      attempts: 0,
    });
    await jobs.execute(original.id);
    await jobs.recover();
    expect(
      await prisma.classificationTask.findUniqueOrThrow({
        where: { id: original.id },
      }),
    ).toEqual(original);
    expect(
      await prisma.classificationTask.count({
        where: { artifactId: source.artifactId },
      }),
    ).toBe(1);
    expect((await listing(source).expect(200)).body).toMatchObject({
      active: false,
      items: [
        {
          task_id: original.id,
          can_retry: true,
          error_code: "classification_configuration_changed",
          result: null,
        },
      ],
    });
    const response = await retry(source, randomUUID()).expect(202);
    const replacement = await prisma.classificationTask.findFirstOrThrow({
      where: { artifactId: source.artifactId },
      orderBy: { cycle: "desc" },
    });
    expect(response.body).toMatchObject({ task_id: replacement.id });
    expect(replacement).toMatchObject({
      cycle: 2,
      fingerprint: jobs.fingerprint,
      state: "queued",
      attempts: 0,
    });
    await otherWorker.execute(replacement.id);
    await otherWorker.recover();
    expect(
      await prisma.classificationTask.findUniqueOrThrow({
        where: { id: replacement.id },
      }),
    ).toEqual(replacement);
    expect(
      await prisma.classificationTask.count({
        where: { artifactId: source.artifactId },
      }),
    ).toBe(2);
    await jobs.execute(replacement.id);
    expect((await listing(source).expect(200)).body).toMatchObject({
      active: false,
      items: [
        { task_id: replacement.id, error_code: null, result: { stage: "PD" } },
      ],
    });
  });

  it("recovers a temporary publication transaction failure without marking the artifact permanently failed", async () => {
    const source = await seed();
    const task = await scheduled(source.artifactId);
    const originalRead = artifacts.read.bind(artifacts);
    let publicationFailure: { mockRestore(): void } | undefined;
    const readSpy = vi
      .spyOn(artifacts, "read")
      .mockImplementationOnce(async (...args) => {
        const artifact = await originalRead(...args);
        // Claim already committed. Fail exactly the publication transaction, then
        // restore real PostgreSQL for recovery and the following execution.
        publicationFailure = vi
          .spyOn(prisma, "$transaction")
          .mockRejectedValueOnce(
            new Error("Synthetic temporary publication failure"),
          );
        return artifact;
      });
    try {
      await expect(jobs.execute(task.id)).rejects.toThrow(
        "Synthetic temporary publication failure",
      );
    } finally {
      publicationFailure?.mockRestore();
      readSpy.mockRestore();
    }
    expect(
      await prisma.classificationTask.findUniqueOrThrow({
        where: { id: task.id },
      }),
    ).toMatchObject({
      state: "processing",
      attempts: 1,
      result: null,
      errorCode: null,
    });
    expect(
      await prisma.outbox.count({
        where: {
          eventType: "classification.failed",
          payload: { path: ["task_id"], equals: task.id },
        },
      }),
    ).toBe(0);
    await prisma.classificationTask.update({
      where: { id: task.id },
      data: { leaseUntil: new Date(0) },
    });
    await jobs.recover();
    await prisma.classificationTask.update({
      where: { id: task.id },
      data: { availableAt: new Date(0) },
    });
    await jobs.execute(task.id);
    expect(
      await prisma.classificationTask.findUniqueOrThrow({
        where: { id: task.id },
      }),
    ).toMatchObject({
      state: "succeeded",
      attempts: 2,
      result: { stage: "PD" },
      errorCode: null,
    });
    expect(
      await prisma.outbox.count({
        where: {
          eventType: "classification.succeeded",
          payload: { path: ["task_id"], equals: task.id },
        },
      }),
    ).toBe(1);
  });
});
