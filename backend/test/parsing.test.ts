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
  type ParseArtifactData,
  type ParsingMessage,
} from "../src/modules/parsing/parsing-contract.js";
import { ParsingJobsService } from "../src/modules/parsing/parsing-jobs.service.js";
import type { ParserProgress } from "../src/modules/parsing/parsing-progress.js";

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
  | "ok"
  | "timeout"
  | "invalid"
  | "busy"
  | "not_ready"
  | "parse_not_ready"
  | "admitted_failure"
  | "missing_image"
  | "regions"
  | "invalid_region"
  | "disconnect" = "ok";
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
  format: "XML" | "PDF" = "XML",
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
      originalName: `synthetic.${format.toLowerCase()}`,
      format,
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
        res.end(
          JSON.stringify({
            cancelled:
              parserMode === "disconnect" &&
              req.url.endsWith(lastParsedRequest),
          }),
        );
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
      expect(body.format).toBe(
        parserMode === "regions" || parserMode === "invalid_region"
          ? "pdf"
          : "xml",
      );
      parseCalls++;
      if (holdResponse) await holdResponse();
      if (parserMode === "busy") {
        res.writeHead(503);
        res.end(JSON.stringify({ code: "parser_busy", retryable: true }));
        return;
      }
      if (parserMode === "parse_not_ready") {
        res.writeHead(503);
        res.end(JSON.stringify({ code: "models_not_ready", retryable: true }));
        return;
      }
      if (parserMode === "admitted_failure") {
        res.writeHead(503);
        res.end(
          JSON.stringify({
            code: "parser_failure",
            retryable: true,
            admitted: true,
            request_id: body.request_id,
            pipeline_fingerprint: fingerprint,
          }),
        );
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
      if (parserMode !== "missing_image")
        await writeFile(resolve(root, "derived", imageKey), png);
      const artifact: ParseArtifactData = {
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
      };
      if (parserMode === "regions" || parserMode === "invalid_region") {
        artifact.region_schema_version = 1;
        artifact.versions.pdf_region_profile = "paddle-regions-v1";
        const page = artifact.pages[0]!;
        page.transform = {
          renderer: "synthetic-pdf",
          coordinate_space: "visible-page-normalized",
          render_width: 1,
          render_height: 1,
          media_box: [0, 0, 1, 1],
          crop_box: [0, 0, 1, 1],
          rotation: 0,
          pdf_to_visible: [1, 0, 0, 1, 0, 0],
          visible_to_pdf: [1, 0, 0, 1, 0, 0],
        };
        page.regions = [
          {
            id: "p1:r1",
            kind: "text",
            bbox: [0, 0, 0.5, 1],
            raw_class: "text",
            raw_score: 0.9,
            method: "native",
            reasons: [],
            table_status: "not_applicable",
          },
          {
            id: "p1:r2",
            kind: "graphic",
            bbox: [0.5, 0, 1, 1],
            raw_class: "image",
            raw_score: 0.8,
            method: "skipped",
            reasons: ["graphic_preserved"],
            table_status: "not_applicable",
          },
        ];
        Object.assign(page.blocks[0]!, {
          source: "native",
          structural_path: null,
          region_id: "p1:r1",
          include_in_main: true,
          bbox: [0, 0, 0.5, 1],
        });
        page.blocks.push({
          ...page.blocks[0]!,
          id: "p1:b1",
          order: 1,
          source: parserMode === "invalid_region" ? "ocr" : "native",
          region_id: "p1:r2",
          include_in_main: false,
          raw_text: "−1,200",
          normalized_text: "−1,200",
          bbox: [0.5, 0, 1, 1],
        });
        artifact.raw_text += "\n−1,200";
        artifact.normalized_text = artifact.raw_text;
      }
      res.end(JSON.stringify(artifact));
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
  it("publishes regional PDF data unchanged, retains excluded native text and rejects OCR in skipped regions", async () => {
    // Synthetic transport fixture only: actual Paddle quality is tested locally
    // against the control corpus, not inferred from this queue/API regression.
    parserMode = "regions";
    try {
      const content = Buffer.from(`synthetic-regional-pdf-${randomUUID()}`);
      const item = await seed(content, "PDF");
      await run(item);
      const response = await get(prefix(item)).expect(200);
      const body = response.body as {
        artifact: ParseArtifactData;
        artifact_id: string;
      };
      expect(body.artifact.region_schema_version).toBe(1);
      expect(body.artifact.pages[0]!.regions).toHaveLength(2);
      expect(body.artifact.pages[0]!.blocks[1]).toMatchObject({
        region_id: "p1:r2",
        include_in_main: false,
        source: "native",
        raw_text: "−1,200",
      });
      expect(body.artifact.raw_text).toBe("Синтетический текст №1\n−1,200");
      await get(
        prefix(item) + "/pages/1?artifact_id=" + body.artifact_id,
      ).expect(200);
      const calls = parseCalls;
      const cached = await seed(content, "PDF");
      await run(cached);
      expect(parseCalls).toBe(calls);
      const cachedBody = (await get(prefix(cached)).expect(200)).body as {
        artifact: ParseArtifactData;
      };
      expect(cachedBody.artifact).toEqual(body.artifact);

      parserMode = "invalid_region";
      const invalid = await seed(
        Buffer.from(`synthetic-invalid-pdf-${randomUUID()}`),
        "PDF",
      );
      await run(invalid);
      expect(
        await prisma.parsingTask.findUniqueOrThrow({
          where: { id: (await message(invalid)).task_id },
        }),
      ).toMatchObject({
        state: "failed",
        errorCode: "parser_invalid_result",
        attempts: 1,
      });
      await get(prefix(invalid)).expect(409);
      expect(
        await prisma.parseArtifact.count({
          where: { taskId: (await message(invalid)).task_id },
        }),
      ).toBe(0);
    } finally {
      parserMode = "ok";
    }
  });

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

  it("preserves last confirmed progress through timeout and model warmup, then accepts a verified checkpoint decrease", async () => {
    const item = await seed();
    await jobs.fanout(item.parent);
    const payload = await message(item);
    const first = await jobs.claim(payload);
    if (!first) throw new Error("Expected initial claim");
    first.pipelineFingerprint = fingerprint;
    await prisma.parsingTask.update({
      where: { id: first.id },
      data: { pipelineFingerprint: fingerprint },
    });
    const progress: ParserProgress = {
      request_id: first.leaseToken,
      pipeline_fingerprint: fingerprint,
      stage: "extracting",
      pages_completed: 8,
      pages_total: 20,
      checkpoint_validated: true,
      checkpoint_pages: 6,
      current_page: 9,
    };
    expect(await jobs.reportProgress(first, progress)).toBe(true);
    const confirmed = await prisma.parsingTask.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(await jobs.reportProgress(first, progress)).toBe(true);
    expect(
      (await prisma.parsingTask.findUniqueOrThrow({ where: { id: first.id } }))
        .progressUpdatedAt,
    ).toEqual(confirmed.progressUpdatedAt);
    await jobs.finishFailure(first, new ParsingError("parser_timeout", true));
    expect(
      await jobs.reportProgress(first, { ...progress, pages_completed: 9 }),
    ).toBe(false);
    await prisma.parsingTask.update({
      where: { id: first.id },
      data: { availableAt: new Date(0) },
    });
    parserMode = "not_ready";
    try {
      await jobs.execute(payload);
    } finally {
      parserMode = "ok";
    }
    const waiting = await prisma.parsingTask.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(waiting).toMatchObject({
      state: "queued",
      attempts: 1,
      phase: "waiting_models",
      waitingReason: "models_not_ready",
      pagesCompleted: 8,
      pagesTotal: 20,
      checkpointPages: 6,
      checkpointValidated: false,
      progressUpdatedAt: confirmed.progressUpdatedAt,
      previousAttemptError: "parser_timeout",
    });
    expect(
      waiting.modelsReadyDeadline!.getTime() - waiting.availableAt.getTime(),
    ).toBeGreaterThan(290_000);
    const listing = await get(
      `/api/v1/objects/${item.objectId}/parsing`,
    ).expect(200);
    expect((listing.body as { items: unknown[] }).items[0]).toMatchObject({
      phase: "waiting_models",
      waiting_reason: "models_not_ready",
      pages_completed: 8,
      pages_total: 20,
      checkpoint_pages: 6,
      checkpoint_validated: false,
      previous_attempt_error: "parser_timeout",
      retry_at: waiting.availableAt.toISOString(),
      progress_updated_at: confirmed.progressUpdatedAt!.toISOString(),
    });
    await prisma.parsingTask.update({
      where: { id: first.id },
      data: { availableAt: new Date(0) },
    });
    const resumed = await jobs.claim(payload);
    if (!resumed) throw new Error("Expected retry claim");
    expect(
      await prisma.parsingTask.findUniqueOrThrow({ where: { id: first.id } }),
    ).toMatchObject({
      phase: "checking_parser",
      pagesCompleted: 8,
      pagesTotal: 20,
    });
    expect(
      await jobs.reportProgress(resumed, {
        ...progress,
        request_id: resumed.leaseToken,
        stage: "checkpoint_verifying",
        pages_completed: 0,
        checkpoint_validated: false,
        checkpoint_pages: null,
        current_page: null,
      }),
    ).toBe(true);
    expect(
      await prisma.parsingTask.findUniqueOrThrow({ where: { id: first.id } }),
    ).toMatchObject({
      phase: "checkpoint_verifying",
      pagesCompleted: 8,
      progressUpdatedAt: confirmed.progressUpdatedAt,
      modelsReadyDeadline: null,
    });
    expect(
      await jobs.reportProgress(resumed, {
        ...progress,
        request_id: resumed.leaseToken,
        stage: "resuming",
        pages_completed: 3,
        checkpoint_pages: 3,
        current_page: 2,
      }),
    ).toBe(true);
    expect(
      await prisma.parsingTask.findUniqueOrThrow({ where: { id: first.id } }),
    ).toMatchObject({
      phase: "resuming",
      pagesCompleted: 3,
      pagesTotal: 20,
      checkpointPages: 3,
      checkpointValidated: true,
      currentPage: 2,
      progressResetReason: "saved_pages_unavailable",
    });
    await prisma.parsingTask.update({
      where: { id: first.id },
      data: { leaseUntil: new Date(0) },
    });
    expect(
      await jobs.reportProgress(resumed, {
        ...progress,
        request_id: resumed.leaseToken,
        pages_completed: 19,
      }),
    ).toBe(false);
    await jobs.finishFailure(
      resumed,
      new ParsingError("worker_lease_expired", true),
      true,
    );
  });

  it("expires continuous model readiness waiting after restart/recovery without spending OCR attempts and permits manual retry", async () => {
    const item = await seed();
    await jobs.fanout(item.parent);
    const payload = await message(item);
    try {
      parserMode = "not_ready";
      await jobs.execute(payload);
      const first = await prisma.parsingTask.findUniqueOrThrow({
        where: { id: payload.task_id },
      });
      const deadline = first.modelsReadyDeadline;
      expect(deadline).not.toBeNull();
      await prisma.parsingTask.update({
        where: { id: payload.task_id },
        data: { availableAt: new Date(0) },
      });
      parserMode = "parse_not_ready"; // A healthy /health does not prove CPU admission.
      await jobs.execute(payload);
      expect(
        await prisma.parsingTask.findUniqueOrThrow({
          where: { id: payload.task_id },
        }),
      ).toMatchObject({
        attempts: 0,
        capacityDeferrals: 2,
        modelsReadyDeadline: deadline,
        phase: "waiting_models",
      });
    } finally {
      parserMode = "ok";
    }
    // Simulate a persisted deadline passing while no new broker delivery arrives.
    await prisma.parsingTask.update({
      where: { id: payload.task_id },
      data: {
        modelsReadyDeadline: new Date(0),
        availableAt: new Date(Date.now() + 60_000),
      },
    });
    await jobs.recover();
    await jobs.recover();
    await jobs.execute(payload);
    expect(
      await prisma.parsingTask.findUniqueOrThrow({
        where: { id: payload.task_id },
      }),
    ).toMatchObject({
      state: "failed",
      attempts: 0,
      errorCode: "models_not_ready_timeout",
      phase: null,
      waitingReason: null,
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
    const listing = await get(
      `/api/v1/objects/${item.objectId}/parsing`,
    ).expect(200);
    expect((listing.body as { items: unknown[] }).items[0]).toMatchObject({
      can_retry: true,
      retry_at: null,
      waiting_reason: null,
      error_code: "models_not_ready_timeout",
    });
    const requestId = randomUUID();
    await request(server)
      .post(prefix(item) + "/retry")
      .auth(inspector.token, { type: "bearer" })
      .send({ request_id: requestId })
      .expect(202);
    const retry = await message(item);
    expect(retry.cycle).toBe(2);
    expect(
      await prisma.parsingTask.findUniqueOrThrow({
        where: { id: retry.task_id },
      }),
    ).toMatchObject({ attempts: 0, modelsReadyDeadline: null });
    await jobs.execute(retry);
    expect(
      await prisma.parsingTask.findUniqueOrThrow({
        where: { id: retry.task_id },
      }),
    ).toMatchObject({
      state: "succeeded",
      attempts: 1,
      phase: null,
      waitingReason: null,
      modelsReadyDeadline: null,
    });
  });

  it.each(["admitted_failure", "missing_image"] as const)(
    "clears the old model deadline after admission before the first progress poll: %s",
    async (mode) => {
      const item = await seed();
      await jobs.fanout(item.parent);
      const payload = await message(item);
      await prisma.parsingTask.update({
        where: { id: payload.task_id },
        data: { modelsReadyDeadline: new Date(Date.now() + 60_000) },
      });
      parserMode = mode;
      holdResponse = async () => {
        // The deadline passes after admission, before the immediate error response.
        await prisma.parsingTask.update({
          where: { id: payload.task_id },
          data: { modelsReadyDeadline: new Date(0) },
        });
      };
      try {
        await jobs.execute(payload);
      } finally {
        parserMode = "ok";
        holdResponse = undefined;
      }
      await jobs.recover();
      expect(
        await prisma.parsingTask.findUniqueOrThrow({
          where: { id: payload.task_id },
        }),
      ).toMatchObject({
        state: "queued",
        attempts: 1,
        phase: "retry_delay",
        errorCode:
          mode === "admitted_failure"
            ? "parser_failure"
            : "source_or_storage_unavailable",
        modelsReadyDeadline: null,
      });
      await prisma.parsingTask.update({
        where: { id: payload.task_id },
        data: { availableAt: new Date(0) },
      });
      await jobs.execute(payload);
      expect(
        await prisma.parsingTask.findUniqueOrThrow({
          where: { id: payload.task_id },
        }),
      ).toMatchObject({ state: "succeeded", attempts: 2 });
    },
  );

  it("explains a pipeline change before replacing historical progress and keeps that reason after checkpoint validation", async () => {
    const item = await seed();
    await jobs.fanout(item.parent);
    const payload = await message(item);
    await prisma.parsingTask.update({
      where: { id: payload.task_id },
      data: {
        pipelineFingerprint: "b".repeat(64),
        pagesCompleted: 8,
        pagesTotal: 20,
        checkpointPages: 6,
        checkpointValidated: true,
        attempts: 1,
        previousAttemptError: "parser_timeout",
      },
    });
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
    try {
      await ready;
      const claimed = await prisma.parsingTask.findUniqueOrThrow({
        where: { id: payload.task_id },
      });
      expect(claimed).toMatchObject({
        pipelineFingerprint: fingerprint,
        progressResetReason: "pipeline_version_changed",
        pagesCompleted: 8,
        pagesTotal: 20,
        checkpointValidated: false,
      });
      expect(
        await jobs.reportProgress(claimed, {
          request_id: claimed.leaseToken!,
          pipeline_fingerprint: fingerprint,
          stage: "extracting",
          pages_completed: 0,
          pages_total: 1,
          checkpoint_validated: true,
          checkpoint_pages: null,
          current_page: 1,
        }),
      ).toBe(true);
      expect(
        await prisma.parsingTask.findUniqueOrThrow({
          where: { id: payload.task_id },
        }),
      ).toMatchObject({
        pagesCompleted: 0,
        pagesTotal: 1,
        progressResetReason: "pipeline_version_changed",
      });
      const listing = await get(
        `/api/v1/objects/${item.objectId}/parsing`,
      ).expect(200);
      expect((listing.body as { items: unknown[] }).items[0]).toMatchObject({
        progress_reset_reason: "pipeline_version_changed",
      });
    } finally {
      holdResponse = undefined;
      release();
      await work;
    }
  });

  it("fences a deadline reached by an active non-admission and its duplicate completion", async () => {
    const item = await seed();
    await jobs.fanout(item.parent);
    const payload = await message(item);
    const task = await jobs.claim(payload);
    if (!task) throw new Error("Expected claim");
    await prisma.parsingTask.update({
      where: { id: task.id },
      data: { modelsReadyDeadline: new Date(0) },
    });
    expect(
      await jobs.finishFailure(
        task,
        new ParsingError("models_not_ready", true),
      ),
    ).toBe(true);
    expect(
      await jobs.finishFailure(
        task,
        new ParsingError("models_not_ready", true),
      ),
    ).toBe(false);
    expect(
      await prisma.parsingTask.findUniqueOrThrow({ where: { id: task.id } }),
    ).toMatchObject({
      state: "failed",
      attempts: 0,
      errorCode: "models_not_ready_timeout",
    });
    expect(
      await prisma.outbox.count({
        where: {
          eventType: "parsing.failed",
          payload: { path: ["task_id"], equals: task.id },
        },
      }),
    ).toBe(1);
  });

  it("cancels the accepted request UUID after an ambiguous socket failure without a deadline abort", async () => {
    const item = await seed();
    await jobs.fanout(item.parent);
    const payload = await message(item);
    const before = cancelCalls;
    const controller = new AbortController();
    await prisma.parsingTask.update({
      where: { id: payload.task_id },
      data: { modelsReadyDeadline: new Date(Date.now() + 60_000) },
    });
    holdResponse = async () => {
      await prisma.parsingTask.update({
        where: { id: payload.task_id },
        data: { modelsReadyDeadline: new Date(0) },
      });
    };
    parserMode = "disconnect";
    try {
      await jobs.execute(payload, controller.signal);
    } finally {
      parserMode = "ok";
      holdResponse = undefined;
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
      modelsReadyDeadline: null,
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
    const staleProgressOwner = await prisma.parsingTask.findUniqueOrThrow({
      where: { id: payload.task_id },
    });
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
    expect(
      await jobs.reportProgress(staleProgressOwner, {
        request_id: staleProgressOwner.leaseToken!,
        pipeline_fingerprint: fingerprint,
        stage: "extracting",
        pages_completed: 1,
        pages_total: 1,
        checkpoint_validated: true,
        checkpoint_pages: 0,
        current_page: 1,
      }),
    ).toBe(false);
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
