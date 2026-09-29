import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { connect, type Channel, type ChannelModel } from "amqplib";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Server } from "node:http";
import { resolve } from "node:path";
import pg from "pg";
import "reflect-metadata";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { writeAuditEvent } from "../src/infrastructure/audit/audit-envelope.js";
import { observeDelivery } from "../src/infrastructure/observability/delivery-observation.js";
import { renderMetrics } from "../src/infrastructure/observability/metrics.js";
import { StructuredLogger } from "../src/infrastructure/observability/structured-logger.js";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import { OutboxService } from "../src/infrastructure/rabbitmq/outbox.service.js";
import { PrivateStorageService } from "../src/infrastructure/storage/private-storage.service.js";
import { AuthService } from "../src/modules/auth/auth.service.js";
import { canonicalJson } from "../src/modules/documents/canonical-json.js";
import {
  record,
  validateMessage,
} from "../src/modules/parsing/parsing-contract.js";
import { ParsingJobsService } from "../src/modules/parsing/parsing-jobs.service.js";

// Own database, broker vhost, container and synthetic storage; no production reset.
const suffix = randomUUID().replaceAll("-", "");
const dbName = "audit_obs_" + suffix;
const root = resolve("../.test-output/observability", dbName);
const container = "inspector-observability-probe-" + suffix;
const rabbitUrl = `amqp://guest:guest@127.0.0.1:25672/${dbName}`;
const parserToken = "synthetic-parser-token-at-least-32-characters";
const metricsToken = "synthetic-metrics-token-at-least-32-characters";
const logs: string[] = [];
let app: INestApplication,
  server: Server,
  prisma: PrismaService,
  storage: PrivateStorageService;
let connection: ChannelModel, channel: Channel;
let inspector: { id: string; token: string },
  outsider: { id: string; token: string },
  admin: { id: string; token: string };
let brokerCreated = false,
  containerCreated = false;
const docker = (...args: string[]) =>
  execFileSync("docker", args, { encoding: "utf8", timeout: 60_000 }).trim();
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

async function account(role: "INSPECTOR" | "ADMINISTRATOR") {
  const session = await app.get(AuthService).register({
    login: "obs-" + randomUUID().slice(0, 8),
    password: "Synthetic-password-123!",
    lastName: "Тестов",
    firstName: "Тест",
  });
  await prisma.user.update({ where: { id: session.user.id }, data: { role } });
  return { id: session.user.id, token: session.accessToken };
}
async function createObject() {
  const untrustedRequestId = randomUUID();
  const response = await request(server)
    .post("/api/v1/objects")
    .auth(inspector.token, { type: "bearer" })
    .set("User-Agent", "synthetic-integration/1")
    .set("X-Request-Id", untrustedRequestId)
    .send({ name: "Синтетический объект аудита" })
    .expect(201);
  expect(response.headers["x-request-id"]).not.toBe(untrustedRequestId);
  return {
    id: (response.body as { id: string }).id,
    requestId: String(response.headers["x-request-id"]),
  };
}
const history = (objectId: string, token = inspector.token) =>
  request(server)
    .get(`/api/v1/objects/${objectId}/audit-events`)
    .auth(token, { type: "bearer" });

beforeAll(async () => {
  const management = new pg.Client({
    connectionString:
      "postgresql://postgres:ingestion-test-only@127.0.0.1:25432/ingestion_test",
  });
  await management.connect();
  await management.query(`CREATE DATABASE "${dbName}"`);
  await management.end();
  await mkdir(resolve(root, "derived"), { recursive: true });
  docker(
    "exec",
    "inspector-ingestion-test-rabbitmq-1",
    "rabbitmqctl",
    "add_vhost",
    dbName,
  );
  brokerCreated = true;
  docker(
    "exec",
    "inspector-ingestion-test-rabbitmq-1",
    "rabbitmqctl",
    "set_permissions",
    "-p",
    dbName,
    "guest",
    ".*",
    ".*",
    ".*",
  );
  docker(
    "run",
    "-d",
    "--name",
    container,
    "--network",
    "bridge",
    "-p",
    "127.0.0.1::8090",
    "--mount",
    `type=bind,source=${resolve("document-parser")},target=/probe/code,readonly`,
    "--mount",
    `type=bind,source=${root},target=/probe/storage`,
    "-e",
    `PARSER_TOKEN=${parserToken}`,
    "--entrypoint",
    "python",
    "inspector-document-parser:local",
    "/probe/code/tests/observability_probe.py",
  );
  containerCreated = true;
  const port = docker("port", container, "8090/tcp").split(":").at(-1);
  const parserUrl = `http://127.0.0.1:${port}`;
  Object.assign(process.env, {
    DATABASE_URL: `postgresql://postgres:ingestion-test-only@127.0.0.1:25432/${dbName}`,
    STORAGE_ROOT: root,
    RABBITMQ_URL: rabbitUrl,
    PARSER_URL: parserUrl,
    PARSER_TOKEN: parserToken,
    METRICS_TOKEN: metricsToken,
    JWT_SECRET: "synthetic-access-secret-at-least-32-characters",
    JWT_REFRESH_SECRET: "synthetic-refresh-secret-at-least-32-characters",
    NODE_ENV: "test",
  });
  execFileSync(
    process.execPath,
    [resolve("../node_modules/prisma/build/index.js"), "migrate", "deploy"],
    { cwd: process.cwd(), env: process.env, stdio: "pipe", timeout: 60_000 },
  );
  const { AppModule } = await import("../src/app.module.js");
  app = await NestFactory.create(AppModule, {
    logger: new StructuredLogger("test", (line) => logs.push(line)),
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
  const instance: unknown = app.getHttpServer();
  if (
    typeof instance !== "object" ||
    instance === null ||
    !("listen" in instance)
  )
    throw new Error("Expected HTTP server");
  server = instance as Server;
  prisma = app.get(PrismaService);
  storage = app.get(PrivateStorageService);
  inspector = await account("INSPECTOR");
  outsider = await account("INSPECTOR");
  admin = await account("ADMINISTRATOR");
  connection = await connect(rabbitUrl);
  channel = await connection.createChannel();
  await channel.assertQueue("inspector.parsing.files", { durable: true });
  await vi.waitFor(
    async () => {
      expect(
        (
          await fetch(`${parserUrl}/health`, {
            headers: { Authorization: `Bearer ${parserToken}` },
            signal: AbortSignal.timeout(1000),
          })
        ).status,
      ).toBe(200);
    },
    { timeout: 30_000 },
  );
});

afterAll(async () => {
  await channel?.close();
  await connection?.close();
  await app?.close();
  if (containerCreated) docker("rm", "-f", container);
  if (brokerCreated)
    docker(
      "exec",
      "inspector-ingestion-test-rabbitmq-1",
      "rabbitmqctl",
      "delete_vhost",
      dbName,
    );
});

describe("AUD / OBS foundation with PostgreSQL, RabbitMQ and native Python parser", () => {
  it("reads real object history with server request identity and safe legacy projection", async () => {
    const object = await createObject();
    const row = await prisma.auditEvent.findFirstOrThrow({
      where: { objectId: object.id },
    });
    expect(row.requestId).toBe(object.requestId);
    const response = await history(object.id).expect(200);
    expect(response.body).toMatchObject({
      items: [
        {
          event_id: row.id,
          user_agent: "synthetic-integration/1",
          metadata_recorded: true,
          correlation_id: object.requestId,
        },
      ],
    });
    await prisma.auditEvent.create({
      data: {
        userId: inspector.id,
        objectId: object.id,
        action: "synthetic.legacy",
        requestId: randomUUID(),
        details: {
          token: "SENSITIVE",
          content_base64: "SENSITIVE",
          run_id: randomUUID(),
        },
      },
    });
    const legacy = await history(object.id).expect(200);
    expect(JSON.stringify(legacy.body)).not.toContain("SENSITIVE");
    expect((legacy.body as { items: unknown[] }).items[0]).toMatchObject({
      metadata_recorded: false,
      correlation_id: null,
      user_agent: null,
    });
  });

  it("enforces assignment and role on every read, including revoked access", async () => {
    const object = await createObject();
    await history(object.id, outsider.token).expect(403);
    await history(object.id, admin.token).expect(403);
    await prisma.objectAccess.delete({
      where: { objectId_userId: { objectId: object.id, userId: inspector.id } },
    });
    await history(object.id).expect(403);
    await request(server)
      .get(`/api/v1/objects/${object.id}/audit-events`)
      .expect(401);
  });

  it("pages by stable timestamp/id without duplicate or skipped old entries during append", async () => {
    const object = await createObject();
    const expected: string[] = [];
    for (let index = 0; index < 5; index++) {
      const row = await prisma.auditEvent.create({
        data: {
          userId: inspector.id,
          objectId: object.id,
          action: "synthetic.page",
          requestId: randomUUID(),
          createdAt: new Date(Date.now() + index * 1000),
          details: {},
        },
      });
      expected.unshift(row.id);
    }
    const first = await history(object.id).query({ limit: 2 }).expect(200);
    const page1 = first.body as {
      items: { event_id: string }[];
      next_cursor: string;
    };
    await prisma.auditEvent.create({
      data: {
        userId: inspector.id,
        objectId: object.id,
        action: "synthetic.append",
        requestId: randomUUID(),
        createdAt: new Date(Date.now() + 10_000),
        details: {},
      },
    });
    const second = await history(object.id)
      .query({ limit: 3, cursor: page1.next_cursor })
      .expect(200);
    const page2 = second.body as { items: { event_id: string }[] };
    expect([...page1.items, ...page2.items].map((row) => row.event_id)).toEqual(
      expected,
    );
    await history(randomUUID())
      .query({ cursor: page1.next_cursor })
      .expect(400);
    await history(object.id).query({ limit: 101 }).expect(400);
  });

  it("rolls back a business change when audit cannot be persisted; history stays untouched", async () => {
    const object = await createObject();
    const before = await prisma.auditEvent.findMany({
      where: { objectId: object.id },
    });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.constructionObject.update({
          where: { id: object.id },
          data: { name: "SHOULD ROLLBACK" },
        });
        await writeAuditEvent(tx, {
          data: {
            userId: randomUUID(),
            objectId: object.id,
            requestId: randomUUID(),
            action: "synthetic.invalid_actor",
            details: {},
          },
        });
      }),
    ).rejects.toThrow();
    expect(
      (
        await prisma.constructionObject.findUniqueOrThrow({
          where: { id: object.id },
        })
      ).name,
    ).not.toBe("SHOULD ROLLBACK");
    expect(
      await prisma.auditEvent.findMany({ where: { objectId: object.id } }),
    ).toEqual(before);
  });

  it("reads an original decision from a selected saved protocol, without using a new head", async () => {
    const object = await createObject();
    const processRow = await prisma.process.create({
      data: { objectId: object.id },
    });
    const run = await prisma.run.create({
      data: {
        objectId: object.id,
        processId: processRow.id,
        version: 1,
        inputManifest: {},
        inputManifestHash: hash("historic-synthetic"),
      },
    });
    const protocol = await prisma.protocol.create({
      data: {
        objectId: object.id,
        processId: processRow.id,
        runId: run.id,
        version: 1,
        status: "superseded",
        scenario: "synthetic",
        inputManifestHash: run.inputManifestHash,
        findingsHash: hash("historic-findings"),
        content: {},
        createdBy: inspector.id,
      },
    });
    const finding = await prisma.finding.create({
      data: {
        protocolId: protocol.id,
        objectId: object.id,
        processId: processRow.id,
        parameterCode: "P001",
        status: "NEGATIVE_VERIFIED",
        membersFingerprint: hash("historic-members"),
        rowVersion: 2,
      },
    });
    const decision = await prisma.findingDecision.create({
      data: {
        findingId: finding.id,
        actorId: inspector.id,
        action: "reject",
        fromStatus: "CANDIDATE",
        toStatus: "NEGATIVE_VERIFIED",
        reasonCode: "OCR_ERROR",
        comment: "Синтетическое сохранённое основание",
      },
    });
    const requestId = randomUUID();
    await prisma.findingDecisionReceipt.create({
      data: {
        userId: inspector.id,
        objectId: object.id,
        requestId,
        findingId: finding.id,
        decisionId: decision.id,
      },
    });
    await prisma.$transaction((tx) =>
      writeAuditEvent(tx, {
        data: {
          userId: inspector.id,
          objectId: object.id,
          requestId: randomUUID(),
          action: "finding.decision",
          details: {
            protocol_id: protocol.id,
            finding_id: finding.id,
            request_id: requestId,
          },
        },
      }),
    );
    await prisma.protocol.create({
      data: {
        objectId: object.id,
        processId: processRow.id,
        runId: run.id,
        version: 2,
        scenario: "synthetic",
        inputManifestHash: run.inputManifestHash,
        findingsHash: hash("new-findings"),
        content: {},
        createdBy: inspector.id,
      },
    });
    const before = await prisma.findingDecision.findUniqueOrThrow({
      where: { id: decision.id },
    });
    const response = await history(object.id)
      .query({ protocol_id: protocol.id })
      .expect(200);
    expect(response.body).toMatchObject({
      protocol_id: protocol.id,
      items: [
        {
          details: { finding_id: finding.id },
          decision: {
            decision_id: decision.id,
            actor_id: inspector.id,
            comment: before.comment,
            reason_code: "OCR_ERROR",
            from_status: "CANDIDATE",
            to_status: "NEGATIVE_VERIFIED",
          },
        },
      ],
    });
    expect(
      await prisma.findingDecision.findUniqueOrThrow({
        where: { id: decision.id },
      }),
    ).toEqual(before);
    await history(object.id).query({ protocol_id: randomUUID() }).expect(404);
  });

  it("propagates an actual retry HTTP request through durable outbox, RabbitMQ, worker and real native parser", async () => {
    const object = await createObject(),
      runId = randomUUID(),
      fileId = randomUUID();
    const processRow = await prisma.process.create({
      data: { objectId: object.id },
    });
    const content = Buffer.from(
      "<document><label>SYNTHETIC-CONTENT-MUST-NOT-BE-IN-LOGS</label></document>",
    );
    const temporary = await storage.temporary();
    await temporary.handle.writeFile(content);
    await temporary.handle.close();
    const storageKey = await storage.publish(temporary.key);
    await storage.discard(temporary.key);
    const manifest = {
      schema_version: 1,
      object_id: object.id,
      process_id: processRow.id,
      run_id: runId,
      files: [{ file_id: fileId, file_hash: hash(content) }],
      versions: {},
    };
    await prisma.run.create({
      data: {
        id: runId,
        objectId: object.id,
        processId: processRow.id,
        version: 1,
        inputManifest: manifest,
        inputManifestHash: hash(canonicalJson(manifest)),
      },
    });
    await prisma.file.create({
      data: {
        id: fileId,
        objectId: object.id,
        processId: processRow.id,
        runId,
        originalName: "synthetic.xml",
        format: "XML",
        size: content.length,
        sha256: hash(content),
        storageKey,
        uploadedBy: inspector.id,
      },
    });
    await prisma.runInput.create({
      data: { runId, fileId, objectId: object.id, processId: processRow.id },
    });
    await prisma.parsingTask.create({
      data: {
        runId,
        fileId,
        objectId: object.id,
        processId: processRow.id,
        state: "failed",
        errorCode: "synthetic_retry",
        completedAt: new Date(),
      },
    });
    const requestId = randomUUID();
    const retry = () =>
      request(server)
        .post(`/api/v1/objects/${object.id}/files/${fileId}/parse/retry`)
        .auth(inspector.token, { type: "bearer" })
        .send({ request_id: requestId });
    const response = await retry().expect(202);
    const correlation = String(response.headers["x-request-id"]);
    const taskId = (response.body as { task_id: string }).task_id;
    await retry().expect(202);
    expect(await prisma.parsingTask.count({ where: { runId } })).toBe(2);
    expect(
      await prisma.auditEvent.count({
        where: { objectId: object.id, action: "parsing.retry.requested" },
      }),
    ).toBe(1);
    const outbox = new OutboxService(prisma, app.get(ConfigService));
    await outbox.dispatchOne();
    const message = await channel.get("inspector.parsing.files", {
      noAck: false,
    });
    if (!message) throw new Error("Expected persistent broker delivery");
    expect(message.properties.headers?.["x-correlation-id"]).toBe(correlation);
    const payload: unknown = JSON.parse(message.content.toString("utf8"));
    expect(record(payload) && payload._trace).toBeUndefined();
    await observeDelivery(
      message.properties.headers,
      message.properties.messageId,
      "parsing",
      () => app.get(ParsingJobsService).execute(validateMessage(payload)),
    );
    channel.ack(message);
    const task = await prisma.parsingTask.findUniqueOrThrow({
      where: { id: taskId },
    });
    expect(task.errorCode).toBeNull();
    expect(task.state).toBe("succeeded");
    expect(await prisma.parseArtifact.count({ where: { taskId } })).toBe(1);
    const historyResponse = await history(object.id).expect(200);
    expect(
      (historyResponse.body as { items: unknown[] }).items[0],
    ).toMatchObject({
      action: "parsing.succeeded",
      correlation_id: correlation,
      actor: { kind: "service", user_id: null },
    });
    const pythonLogs = docker("logs", container);
    expect(pythonLogs).toContain(correlation);
    expect(pythonLogs).toContain('"operation":"parse"');
    expect(pythonLogs).not.toContain("SYNTHETIC-CONTENT-MUST-NOT-BE-IN-LOGS");
    expect(logs.join("\n")).not.toContain(
      "SYNTHETIC-CONTENT-MUST-NOT-BE-IN-LOGS",
    );
    const correlated = logs
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line.correlation_id === correlation);
    expect(correlated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: "http.request.finished" }),
        expect.objectContaining({ message: "outbox.delivery.confirmed" }),
      ]),
    );
  });

  it("requires technical credential for real metrics and marks missing sources unavailable", async () => {
    await request(server).get("/api/internal/metrics").expect(401);
    await request(server)
      .get("/api/internal/metrics")
      .auth(admin.token, { type: "bearer" })
      .expect(401);
    const response = await request(server)
      .get("/api/internal/metrics")
      .auth(metricsToken, { type: "bearer" })
      .expect(200);
    expect(response.text).toContain(
      'inspector_http_request_duration_seconds_count{method="GET"',
    );
    expect(response.text).toContain(
      'inspector_metrics_source_up{source="database"} 1',
    );
    expect(response.text).toContain(
      'inspector_queue_source_up{queue="inspector.parsing.files"} 1',
    );
    expect(response.text).toMatch(/inspector_active_sessions [1-9]/);
    expect(response.text).not.toMatch(/object_id|user_id|SENSITIVE/);
    const sample = (text: string, name: string) => {
      const line = text
        .split("\n")
        .find((entry) => entry.startsWith(name + " "));
      if (!line) throw new Error("Expected actual metric: " + name);
      return Number(line.slice(name.length + 1));
    };
    const countName =
      'inspector_http_request_duration_seconds_count{method="GET",status_class="2xx"}';
    const sumName =
      'inspector_http_request_duration_seconds_sum{method="GET",status_class="2xx"}';
    const object = await createObject();
    for (let index = 0; index < 3; index++)
      await history(object.id).expect(200);
    const loaded = await request(server)
      .get("/api/internal/metrics")
      .auth(metricsToken, { type: "bearer" })
      .expect(200);
    expect(sample(loaded.text, countName)).toBeGreaterThanOrEqual(
      sample(response.text, countName) + 3,
    );
    expect(sample(loaded.text, sumName)).toBeGreaterThan(
      sample(response.text, sumName),
    );
    expect(
      sample(loaded.text, "process_resident_memory_bytes"),
    ).toBeGreaterThan(0);
    expect(sample(loaded.text, "inspector_outbox_pending")).toBe(
      await prisma.outbox.count({ where: { deliveredAt: null } }),
    );
    const queue = "inspector.parsing.files";
    const ready = (await channel.checkQueue(queue)).messageCount;
    channel.sendToQueue(queue, Buffer.from("synthetic-metric-probe"));
    await channel.checkQueue(queue);
    const queued = await renderMetrics(prisma, root, rabbitUrl);
    expect(
      sample(queued, `inspector_queue_ready_messages{queue="${queue}"}`),
    ).toBe(ready + 1);
    const delivered = await channel.get(queue, { noAck: false });
    if (delivered) channel.ack(delivered);
    const config = app.get(ConfigService);
    config.set("METRICS_TOKEN", "");
    try {
      await request(server)
        .get("/api/internal/metrics")
        .auth(metricsToken, { type: "bearer" })
        .expect(404);
    } finally {
      config.set("METRICS_TOKEN", metricsToken);
    }
    const unavailable = await renderMetrics(prisma, resolve(root, "missing"));
    expect(unavailable).toContain(
      'inspector_metrics_source_up{source="storage"} 0',
    );
    expect(unavailable).not.toContain("inspector_storage_available_bytes");
  });
});
