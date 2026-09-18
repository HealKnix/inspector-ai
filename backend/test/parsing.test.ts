import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { connect } from "amqplib";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import pg from "pg";
import "reflect-metadata";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import { PrivateStorageService } from "../src/infrastructure/storage/private-storage.service.js";
import { AuthService } from "../src/modules/auth/auth.service.js";
import { canonicalJson } from "../src/modules/documents/canonical-json.js";
import {
  ParsingError,
  type ParsingMessage,
} from "../src/modules/parsing/parsing-contract.js";
import { ParsingJobsService } from "../src/modules/parsing/parsing-jobs.service.js";

// These integration tests use real PostgreSQL, RabbitMQ, storage and HTTP. The
// parser HTTP fixture isolates queue/durability faults; it is not OCR evidence.
const dbName = "parsing_" + randomUUID().replaceAll("-", "");
const databaseUrl =
  "postgresql://postgres:ingestion-test-only@127.0.0.1:25432/" + dbName;
const root = resolve("../.test-output/parsing", dbName);
const fingerprint = "d".repeat(64);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j/qkAAAAASUVORK5CYII=",
  "base64",
);
let app: INestApplication;
let server: Server;
let parserServer: Server;
let prisma: PrismaService;
let storage: PrivateStorageService;
let jobs: ParsingJobsService;
let inspector: { id: string; token: string };
let outsider: { id: string; token: string };
let admin: { id: string; token: string };
let parseCalls = 0;
let cancelCalls = 0;
const cancelledRequests: string[] = [];
let lastParsedRequest = "";
let parserMode:
  "ok" | "timeout" | "invalid" | "busy" | "not_ready" | "disconnect" = "ok";
let holdResponse: (() => Promise<void>) | undefined;

async function account(role: "INSPECTOR" | "ADMINISTRATOR") {
  const session = await app
    .get(AuthService)
    .register("par-" + randomUUID().slice(0, 8), "Synthetic-password-123!");
  await prisma.user.update({ where: { id: session.user.id }, data: { role } });
  return { id: session.user.id, token: session.accessToken };
}
function digest(data: Buffer | string) {
  return createHash("sha256").update(data).digest("hex");
}
async function seed(
  content = Buffer.from(`<synthetic id="${randomUUID()}"/>`),
) {
  const object = await prisma.constructionObject.create({
    data: { name: "Синтетический объект PAR", createdBy: inspector.id },
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
    files: [{ file_id: fileId, file_hash: digest(content) }],
    versions: {},
  };
  const run = await prisma.run.create({
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
      originalName: "synthetic.xml",
      format: "XML",
      size: content.length,
      sha256: digest(content),
      storageKey,
      uploadedBy: inspector.id,
    },
  });
  await prisma.runInput.create({
    data: { runId, fileId, objectId: object.id, processId: process.id },
  });
  const job = await prisma.job.create({
    data: {
      runId,
      objectId: object.id,
      processId: process.id,
      kind: "document.parsing",
    },
  });
  const parent = {
    schema_version: 1,
    event_type: "documents.accepted",
    job_id: job.id,
    object_id: object.id,
    process_id: process.id,
    run_id: runId,
    input_manifest_hash: run.inputManifestHash,
  };
  return {
    objectId: object.id,
    processId: process.id,
    runId,
    fileId,
    parent,
    storageKey,
  };
}
type Seed = Awaited<ReturnType<typeof seed>>;
async function message(seed: Seed): Promise<ParsingMessage> {
  const task = await prisma.parsingTask.findFirstOrThrow({
    where: { runId: seed.runId, fileId: seed.fileId },
    orderBy: { cycle: "desc" },
  });
  return {
    schema_version: 1,
    task_id: task.id,
    object_id: seed.objectId,
    process_id: seed.processId,
    run_id: seed.runId,
    file_id: seed.fileId,
    cycle: task.cycle,
  };
}
async function run(seed: Seed) {
  await jobs.fanout(seed.parent);
  await jobs.execute(await message(seed));
}
function get(url: string, user = inspector) {
  return request(server).get(url).auth(user.token, { type: "bearer" });
}
function prefix(seed: Seed) {
  return `/api/v1/objects/${seed.objectId}/files/${seed.fileId}/parse`;
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
  parserServer = createServer((req, res) => {
    void (async () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/health") {
        if (parserMode === "not_ready") {
          res.writeHead(503);
          res.end(
            JSON.stringify({ code: "models_not_ready", retryable: true }),
          );
          return;
        }
        res.end(
          JSON.stringify({
            status: "ok",
            pipeline_fingerprint: fingerprint,
            versions: { parser: "synthetic" },
          }),
        );
        return;
      }
      if (req.url?.startsWith("/progress/")) {
        res.end(
          JSON.stringify({
            pages_completed: 0,
            pages_total: 1,
            stage: "synthetic",
          }),
        );
        return;
      }
      if (req.url?.startsWith("/cancel/")) {
        cancelCalls++;
        cancelledRequests.push(req.url.slice("/cancel/".length));
        res.end("{}");
        return;
      }
      expect(req.headers.authorization).toBe("Bearer " + "p".repeat(32));
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        source_sha256: string;
        format: string;
        request_id: string;
      };
      lastParsedRequest = body.request_id;
      expect(body.format).toBe("xml");
      parseCalls++;
      if (holdResponse) await holdResponse();
      if (parserMode === "busy") {
        res.writeHead(503);
        res.end(JSON.stringify({ code: "parser_busy", retryable: true }));
        return;
      }
      if (parserMode === "disconnect") {
        res.destroy();
        return;
      }
      if (parserMode === "timeout") {
        res.writeHead(504);
        res.end(JSON.stringify({ code: "parser_timeout", retryable: true }));
        return;
      }
      const imageKey = randomUUID();
      await writeFile(resolve(root, "derived", imageKey), png);
      res.end(
        JSON.stringify({
          schema_version: 1,
          source_sha256:
            parserMode === "invalid" ? "f".repeat(64) : body.source_sha256,
          pipeline_fingerprint: fingerprint,
          versions: { parser: "synthetic-v1" },
          raw_text: "Синтетический текст №1",
          normalized_text: "Синтетический текст №1",
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
                  raw_text: "Синтетический текст №1",
                  normalized_text: "Синтетический текст №1",
                  bbox: [0, 0, 1, 1],
                  confidence: null,
                  source: "structured",
                  structural_path: "/synthetic",
                  table_id: null,
                  row: null,
                  column: null,
                  row_span: null,
                  column_span: null,
                },
              ],
            },
          ],
        }),
      );
    })().catch(() => {
      res.statusCode = 500;
      res.end("{}");
    });
  });
  await new Promise<void>((done) => parserServer.listen(0, "127.0.0.1", done));
  const parserPort = (parserServer.address() as AddressInfo).port;
  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    STORAGE_ROOT: root,
    JWT_SECRET: "synthetic-access-secret-at-least-32-characters",
    JWT_REFRESH_SECRET: "synthetic-refresh-secret-at-least-32-characters",
    NODE_ENV: "test",
    PARSER_URL: `http://127.0.0.1:${parserPort}`,
    PARSER_TOKEN: "p".repeat(32),
    PARSER_FILE_TIMEOUT_SECONDS: "2",
    REDIS_URL: "redis://127.0.0.1:1",
    RABBITMQ_URL: "amqp://guest:guest@127.0.0.1:25672",
  });
  execFileSync(
    process.execPath,
    [resolve("../node_modules/prisma/build/index.js"), "migrate", "deploy"],
    { cwd: process.cwd(), env: process.env, stdio: "pipe" },
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
  jobs = app.get(ParsingJobsService);
  inspector = await account("INSPECTOR");
  outsider = await account("INSPECTOR");
  admin = await account("ADMINISTRATOR");
});
afterAll(async () => {
  await app?.close();
  parserServer?.closeAllConnections();
  await new Promise<void>((done) => parserServer?.close(() => done()));
  await writeFile(resolve(root, "database.txt"), dbName);
});

describe("PAR durable execution and access (real PG/broker/storage, parser fault fixture)", () => {
  it("backfills legacy Runs once, publishes through duplicate Rabbit delivery, and survives Redis loss", async () => {
    const item = await seed();
    await jobs.recover();
    await Promise.all([jobs.fanout(item.parent), jobs.fanout(item.parent)]);
    expect(
      await prisma.parsingTask.count({ where: { runId: item.runId } }),
    ).toBe(1);
    const payload = await message(item);
    const connection = await connect("amqp://guest:guest@127.0.0.1:25672");
    const channel = await connection.createConfirmChannel();
    try {
      const queue = await channel.assertQueue("", { exclusive: true });
      channel.sendToQueue(queue.queue, Buffer.from(JSON.stringify(payload)), {
        persistent: true,
      });
      await channel.waitForConfirms();
      const delivery = await channel.get(queue.queue, { noAck: false });
      if (!delivery) throw new Error("Expected broker delivery");
      await jobs.execute(
        JSON.parse(delivery.content.toString()) as ParsingMessage,
      );
      channel.nack(delivery, false, true);
      const duplicate = await channel.get(queue.queue, { noAck: false });
      if (!duplicate) throw new Error("Expected redelivery");
      await jobs.execute(
        JSON.parse(duplicate.content.toString()) as ParsingMessage,
      );
      channel.ack(duplicate);
    } finally {
      await connection.close();
    }
    const task = await prisma.parsingTask.findUniqueOrThrow({
      where: { id: payload.task_id },
    });
    expect(task.state).toBe("succeeded");
    expect(task.attempts).toBe(1);
    expect(
      (
        await prisma.process.findUniqueOrThrow({
          where: { id: item.processId },
        })
      ).status,
    ).toBe("PENDING");
    const response = await get(prefix(item)).expect(200);
    const artifact = response.body as { artifact_id: string; run_id: string };
    expect(artifact.run_id).toBe(item.runId);
    await get(prefix(item) + "/pages/1?artifact_id=" + artifact.artifact_id)
      .expect(200)
      .expect("Content-Type", /image\/png/)
      .expect("Cache-Control", "private, no-store");
    await get(prefix(item) + "/pages/1?artifact_id=" + randomUUID()).expect(
      409,
    );
    const listing = await get(
      `/api/v1/objects/${item.objectId}/parsing`,
    ).expect(200);
    expect((listing.body as { active: boolean }).active).toBe(false);
  });

  it("reuses matching content without moving object bindings and fails closed on object/role/session access", async () => {
    const content = Buffer.from(`<reuse id="${randomUUID()}"/>`);
    const first = await seed(content);
    await run(first);
    const calls = parseCalls;
    const second = await seed(content);
    await run(second);
    expect(parseCalls).toBe(calls);
    const artifact = (await get(prefix(second)).expect(200)).body as {
      file_id: string;
      run_id: string;
    };
    expect(artifact).toMatchObject({
      file_id: second.fileId,
      run_id: second.runId,
    });
    for (const user of [outsider, admin]) {
      await get(prefix(first), user).expect(403);
      await get(prefix(first) + "/pages/1", user).expect(403);
      await request(server)
        .post(prefix(first) + "/retry")
        .auth(user.token, { type: "bearer" })
        .send({ request_id: randomUUID() })
        .expect(403);
    }
    await get(
      `/api/v1/objects/${second.objectId}/files/${first.fileId}/parse`,
    ).expect(404);
    const revoked = await account("INSPECTOR");
    await prisma.objectAccess.create({
      data: {
        objectId: first.objectId,
        userId: revoked.id,
        grantedBy: inspector.id,
      },
    });
    await prisma.authSession.updateMany({
      where: { userId: revoked.id },
      data: { revokedAt: new Date() },
    });
    await get(prefix(first), revoked).expect(401);
    await request(server)
      .post(prefix(first) + "/retry")
      .auth(revoked.token, { type: "bearer" })
      .send({ request_id: randomUUID() })
      .expect(401);
  });

  it("stops after three transient attempts, keeps one terminal event, and leaves PENDING", async () => {
    const item = await seed();
    await jobs.fanout(item.parent);
    const payload = await message(item);
    parserMode = "timeout";
    try {
      for (let count = 1; count <= 3; count++) {
        await prisma.parsingTask.update({
          where: { id: payload.task_id },
          data: { availableAt: new Date(0) },
        });
        await jobs.execute(payload);
        expect(
          (
            await prisma.parsingTask.findUniqueOrThrow({
              where: { id: payload.task_id },
            })
          ).attempts,
        ).toBe(count);
      }
      await jobs.execute(payload);
    } finally {
      parserMode = "ok";
    }
    expect(
      await prisma.parsingTask.findUniqueOrThrow({
        where: { id: payload.task_id },
      }),
    ).toMatchObject({
      state: "failed",
      attempts: 3,
      errorCode: "parser_timeout",
    });
    expect(
      await prisma.outbox.count({
        where: {
          eventType: "parsing.failed",
          payload: { path: ["task_id"], equals: payload.task_id },
        },
      }),
    ).toBe(1);
    expect(
      (
        await prisma.process.findUniqueOrThrow({
          where: { id: item.processId },
        })
      ).status,
    ).toBe("PENDING");
    await get(prefix(item)).expect(409);
  });

  it.each(["busy", "not_ready"] as const)(
    "waits for parser %s without spending document attempts, then processes every waiting file",
    async (refusal) => {
      const items = [await seed(), await seed()];
      for (const item of items) await jobs.fanout(item.parent);
      const payloads = await Promise.all(items.map(message));
      const cancelledBefore = cancelCalls;
      const parseCallsBefore = parseCalls;
      parserMode = refusal;
      try {
        for (let count = 0; count < 5; count++)
          for (const payload of payloads) {
            await prisma.parsingTask.update({
              where: { id: payload.task_id },
              data: { availableAt: new Date(0) },
            });
            const before = Date.now();
            await jobs.execute(payload);
            const deferred = await prisma.parsingTask.findUniqueOrThrow({
              where: { id: payload.task_id },
            });
            expect(deferred).toMatchObject({
              state: "queued",
              attempts: 0,
              capacityDeferrals: count + 1,
              errorCode:
                refusal === "busy" ? "parser_busy" : "models_not_ready",
              leaseToken: null,
              leaseUntil: null,
            });
            expect(deferred.availableAt.getTime()).toBeGreaterThanOrEqual(
              before + Math.min(60_000, 5000 * 2 ** count),
            );
            const calls = parseCalls;
            await jobs.execute(payload);
            expect(parseCalls).toBe(calls); // Redelivery before backoff cannot hot-loop.
            expect(
              (
                await prisma.process.findUniqueOrThrow({
                  where: { id: payload.process_id },
                })
              ).status,
            ).toBe("PARSING");
          }
      } finally {
        parserMode = "ok";
      }
      expect(cancelCalls).toBe(cancelledBefore); // Non-admission never cancels another owner.
      if (refusal === "not_ready") expect(parseCalls).toBe(parseCallsBefore);
      for (const payload of payloads) {
        await prisma.parsingTask.update({
          where: { id: payload.task_id },
          data: { availableAt: new Date(0) },
        });
        await jobs.execute(payload);
        expect(
          await prisma.parsingTask.findUniqueOrThrow({
            where: { id: payload.task_id },
          }),
        ).toMatchObject({
          state: "succeeded",
          attempts: 1,
          capacityDeferrals: 5,
        });
        expect(
          await prisma.outbox.count({
            where: {
              eventType: "parsing.failed",
              payload: { path: ["task_id"], equals: payload.task_id },
            },
          }),
        ).toBe(0);
        expect(
          (
            await prisma.process.findUniqueOrThrow({
              where: { id: payload.process_id },
            })
          ).status,
        ).toBe("PENDING");
      }
    },
  );

  it("cancels the accepted request UUID after an ambiguous socket failure without a deadline abort", async () => {
    const item = await seed();
    await jobs.fanout(item.parent);
    const payload = await message(item);
    const before = cancelCalls;
    const controller = new AbortController();
    parserMode = "disconnect";
    try {
      await jobs.execute(payload, controller.signal);
    } finally {
      parserMode = "ok";
    }
    expect(controller.signal.aborted).toBe(false);
    expect(cancelCalls).toBe(before + 1);
    expect(cancelledRequests.at(-1)).toBe(lastParsedRequest);
    expect(
      await prisma.parsingTask.findUniqueOrThrow({
        where: { id: payload.task_id },
      }),
    ).toMatchObject({
      state: "queued",
      attempts: 1,
      errorCode: "parser_unavailable",
    });
  });

  it("rejects invalid parser provenance as permanent failure", async () => {
    const item = await seed();
    parserMode = "invalid";
    try {
      await run(item);
    } finally {
      parserMode = "ok";
    }
    const payload = await message(item);
    expect(
      await prisma.parsingTask.findUniqueOrThrow({
        where: { id: payload.task_id },
      }),
    ).toMatchObject({
      state: "failed",
      attempts: 1,
      errorCode: "parser_invalid_result",
    });
    expect(
      await prisma.parseArtifact.count({ where: { taskId: payload.task_id } }),
    ).toBe(0);
  });
  it("rejects queue messages for a different file or execution cycle without spending an attempt", async () => {
    const item = await seed();
    await jobs.fanout(item.parent);
    const payload = await message(item);
    await expect(
      jobs.claim({ ...payload, file_id: randomUUID() }),
    ).rejects.toThrow("invalid_queue_message");
    await expect(
      jobs.claim({ ...payload, cycle: payload.cycle + 1 }),
    ).rejects.toThrow("invalid_queue_message");
    expect(
      await prisma.parsingTask.findUniqueOrThrow({
        where: { id: payload.task_id },
      }),
    ).toMatchObject({ state: "queued", attempts: 0 });
  });

  it("recovers an expired worker lease without letting the old token publish or reset attempts", async () => {
    const item = await seed();
    await jobs.fanout(item.parent);
    const payload = await message(item);
    const stale = await jobs.claim(payload);
    expect(stale).not.toBeNull();
    await prisma.parsingTask.update({
      where: { id: payload.task_id },
      data: { leaseUntil: new Date(0) },
    });
    await jobs.recover();
    expect(
      await jobs.finishFailure(
        stale!,
        new ParsingError("parser_timeout", true),
      ),
    ).toBe(false);
    await prisma.parsingTask.update({
      where: { id: payload.task_id },
      data: { availableAt: new Date(0) },
    });
    await Promise.all([jobs.execute(payload), jobs.execute(payload)]);
    expect(
      await prisma.parsingTask.findUniqueOrThrow({
        where: { id: payload.task_id },
      }),
    ).toMatchObject({ state: "succeeded", attempts: 2 });
    expect(
      await prisma.parseArtifact.count({ where: { taskId: payload.task_id } }),
    ).toBe(1);
  });

  it("makes manual retry idempotent and keeps originals/history while hiding the preceding artifact", async () => {
    const item = await seed();
    await run(item);
    const originalArtifact = (await get(prefix(item)).expect(200)).body as {
      artifact_id: string;
    };
    const requestId = randomUUID();
    const retry = () =>
      request(server)
        .post(prefix(item) + "/retry")
        .auth(inspector.token, { type: "bearer" })
        .send({ request_id: requestId })
        .expect(202);
    const responses = await Promise.all([retry(), retry()]);
    expect(responses[0].body).toEqual(responses[1].body);
    expect(
      await prisma.file.count({ where: { objectId: item.objectId } }),
    ).toBe(1);
    expect(
      await prisma.parsingTask.count({ where: { runId: item.runId } }),
    ).toBe(2);
    await get(prefix(item)).expect(409);
    const calls = parseCalls;
    await jobs.execute(await message(item));
    expect(parseCalls).toBe(calls + 1);
    const current = (await get(prefix(item)).expect(200)).body as {
      artifact_id: string;
    };
    expect(current.artifact_id).not.toBe(originalArtifact.artifact_id);
    await get(
      prefix(item) + "/pages/1?artifact_id=" + originalArtifact.artifact_id,
    ).expect(409);
    await retry();
    expect(
      await prisma.parsingTask.count({ where: { runId: item.runId } }),
    ).toBe(2);
  });

  it("rejects a late parser result after the current Run changes", async () => {
    const item = await seed();
    await jobs.fanout(item.parent);
    const payload = await message(item);
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((done) => {
      release = done;
    });
    const ready = new Promise<void>((done) => {
      entered = done;
    });
    holdResponse = () => {
      entered();
      return held;
    };
    const work = jobs.execute(payload);
    await ready;
    const nextRun = randomUUID();
    await prisma.$transaction(async (tx) => {
      await tx.process.update({
        where: { id: item.processId },
        data: { version: 2, status: "PENDING" },
      });
      await tx.run.create({
        data: {
          id: nextRun,
          objectId: item.objectId,
          processId: item.processId,
          version: 2,
          inputManifest: {},
          inputManifestHash: "e".repeat(64),
        },
      });
      await tx.runInput.create({
        data: {
          runId: nextRun,
          fileId: item.fileId,
          objectId: item.objectId,
          processId: item.processId,
        },
      });
    });
    holdResponse = undefined;
    release();
    await work;
    expect(
      await prisma.parseArtifact.count({ where: { taskId: payload.task_id } }),
    ).toBe(0);
    expect(
      (
        await prisma.process.findUniqueOrThrow({
          where: { id: item.processId },
        })
      ).status,
    ).toBe("PENDING");
    await get(prefix(item)).expect(409);
  });
  it("cancels the parser request on worker shutdown and durably schedules a bounded retry", async () => {
    const item = await seed();
    await jobs.fanout(item.parent);
    const payload = await message(item);
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((done) => {
      release = done;
    });
    const ready = new Promise<void>((done) => {
      entered = done;
    });
    holdResponse = () => {
      entered();
      return held;
    };
    const controller = new AbortController();
    const before = cancelCalls;
    const work = jobs.execute(payload, controller.signal);
    await ready;
    controller.abort();
    await work;
    holdResponse = undefined;
    release();
    expect(cancelCalls).toBe(before + 1);
    expect(
      await prisma.parsingTask.findUniqueOrThrow({
        where: { id: payload.task_id },
      }),
    ).toMatchObject({
      state: "queued",
      attempts: 1,
      errorCode: "parser_timeout",
    });
    expect(
      await prisma.parseArtifact.count({ where: { taskId: payload.task_id } }),
    ).toBe(0);
  });
});
