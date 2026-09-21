import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { resolve } from "node:path";
import pg from "pg";
import "reflect-metadata";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import { AuthService } from "../src/modules/auth/auth.service.js";

// Same disposable test PostgreSQL as the other integration suites.
const dbName = "verification_" + randomUUID().replaceAll("-", "");
const databaseUrl =
  "postgresql://postgres:ingestion-test-only@127.0.0.1:25432/" + dbName;

let app: INestApplication;
let server: Server;
let prisma: PrismaService;
let inspector: { id: string; token: string };
let outsider: { id: string; token: string };
let admin: { id: string; token: string };

function isHttpServer(value: unknown): value is Server {
  return typeof value === "object" && value !== null && "listen" in value;
}

async function account(role: "INSPECTOR" | "ADMINISTRATOR" | null) {
  const session = await app
    .get(AuthService)
    .register("synthetic-" + randomUUID().slice(0, 8), "Test-password-123!");
  await prisma.user.update({
    where: { id: session.user.id },
    data: { role },
  });
  return { id: session.user.id, token: session.accessToken };
}

const PLAN = { kind: "regex", anchors: ["площадь"], pattern: "(\\d+)" };
const SPEC = { kind: "equals" };

function member(
  fileId: string,
  role: "expected" | "actual",
  value: number | string,
) {
  return {
    extraction_id: randomUUID(),
    file_id: fileId,
    stage: role === "expected" ? "PD" : "RD",
    role,
    status: "extracted",
    value,
    value_raw: String(value),
    unit: "m2",
  };
}

function verdict(status: string, expected: number, actual: number | null) {
  return {
    engine: "comparison-engine-v2",
    status,
    spec: SPEC,
    expected: [
      {
        extraction_id: randomUUID(),
        file_id: randomUUID(),
        value: expected,
        value_raw: String(expected),
        unit: "m2",
      },
    ],
    actual:
      actual === null
        ? null
        : [
            {
              extraction_id: randomUUID(),
              file_id: randomUUID(),
              value: actual,
              value_raw: String(actual),
              unit: "m2",
            },
          ],
    pairs: [],
    warnings: [],
    evaluated_at: new Date().toISOString(),
  };
}

/** Объект + процесс + запуск + файл + матрица/правила/группы P001–P005. */
async function seedObject() {
  const created = await request(server)
    .post("/api/v1/objects")
    .auth(inspector.token, { type: "bearer" })
    .send({ name: "Верификация-синтетик" })
    .expect(201);
  const objectId = (created.body as { id: string }).id;
  const process = await prisma.process.create({
    data: { objectId, status: "PENDING", version: 1 },
  });
  const run = await prisma.run.create({
    data: {
      processId: process.id,
      objectId,
      version: 1,
      inputManifest: { schema_version: 1, files: [] },
      inputManifestHash: createHash("sha256").update("synthetic").digest("hex"),
    },
  });
  const file = await prisma.file.create({
    data: {
      objectId,
      processId: process.id,
      runId: run.id,
      originalName: "synthetic.pdf",
      format: "PDF",
      size: 1,
      sha256: createHash("sha256").update("file").digest("hex"),
      storageKey: randomUUID(),
      uploadedBy: inspector.id,
    },
  });
  await prisma.runInput.create({
    data: { runId: run.id, fileId: file.id, processId: process.id, objectId },
  });
  const groups: Record<
    string,
    { status: string; expected: number; actual: number | null }
  > = {
    P001: { status: "discrepancy", expected: 100, actual: 120 },
    P002: { status: "match", expected: 100, actual: 100 },
    P003: { status: "discrepancy", expected: 5, actual: 7 },
    P005: { status: "actual_missing", expected: 3, actual: null },
  };
  for (const [code, group] of Object.entries(groups)) {
    await prisma.evidenceGroup.create({
      data: {
        objectId,
        processId: process.id,
        parameterCode: code,
        scopeKey: "",
        rulesetHash: createHash("sha256").update("rules").digest("hex"),
        members: [
          member(file.id, "expected", group.expected),
          ...(group.actual === null
            ? []
            : [member(file.id, "actual", group.actual)]),
        ],
        verdict: verdict(group.status, group.expected, group.actual),
      },
    });
  }
  return { objectId, processId: process.id, fileId: file.id };
}

/** Матрица и утверждённые правила — глобальный реестр, сеется один раз. */
async function seedMatrix() {
  const matrixImport = await prisma.matrixImport.create({
    data: {
      sourceName: "synthetic-matrix",
      sourceSha256: createHash("sha256").update(randomUUID()).digest("hex"),
      originSha256: createHash("sha256").update(randomUUID()).digest("hex"),
      rowCount: 5,
    },
  });
  for (const [index, code] of [
    "P001",
    "P002",
    "P003",
    "P004",
    "P005",
  ].entries()) {
    await prisma.matrixRow.create({
      data: {
        importId: matrixImport.id,
        parameterId: index + 1,
        parameterCode: code,
        pdSection: "ПЗ",
        name: `Параметр ${code}`,
        sourcePd: "ПЗ",
        sourceRd: "КЖ",
        triggerText: "триггер",
        matrixRow: index + 1,
        raw: {},
      },
    });
    if (code !== "P004") {
      await prisma.ruleVersion.create({
        data: {
          parameterCode: code,
          parameterId: index + 1,
          version: 1,
          status: "approved",
          plan: PLAN,
          comparison: SPEC,
          approvedBy: admin.id,
          approvedAt: new Date(),
        },
      });
    }
  }
}

function generate(objectId: string, user = inspector) {
  return request(server)
    .post(`/api/v1/objects/${objectId}/protocol/generate`)
    .auth(user.token, { type: "bearer" })
    .send({});
}

function decide(
  objectId: string,
  findingId: string,
  body: Record<string, unknown>,
  user = inspector,
) {
  return request(server)
    .post(`/api/v1/objects/${objectId}/findings/${findingId}/decision`)
    .auth(user.token, { type: "bearer" })
    .send(body);
}

async function candidateCodes(objectId: string): Promise<string[]> {
  const response = await request(server)
    .get(`/api/v1/objects/${objectId}/findings`)
    .auth(inspector.token, { type: "bearer" })
    .query({ status: "CANDIDATE" })
    .expect(200);
  return (response.body as { items: { parameter_code: string }[] }).items.map(
    (item) => item.parameter_code,
  );
}

beforeAll(async () => {
  const management = new pg.Client({
    connectionString:
      "postgresql://postgres:ingestion-test-only@127.0.0.1:25432/ingestion_test",
  });
  await management.connect();
  await management.query('CREATE DATABASE "' + dbName + '"');
  await management.end();
  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    STORAGE_ROOT: "../.test-output/storage",
    CLAMAV_HOST: "127.0.0.1",
    CLAMAV_PORT: "23310",
    FILE_VALIDATOR_URL: "http://127.0.0.1:28081",
    RABBITMQ_URL: "amqp://guest:guest@127.0.0.1:25672",
    JWT_SECRET: "synthetic-access-secret-at-least-32-characters",
    JWT_REFRESH_SECRET: "synthetic-refresh-secret-at-least-32-characters",
    NODE_ENV: "test",
  });
  execFileSync(
    process.execPath,
    [resolve("../node_modules/prisma/build/index.js"), "migrate", "deploy"],
    { cwd: process.cwd(), env: process.env, stdio: "pipe" },
  );
  const { AppModule } = await import("../src/app.module.js");
  app = await NestFactory.create(AppModule, {
    bodyParser: false,
    logger: ["error"],
    abortOnError: false,
  });
  app.setGlobalPrefix("api");
  app.use(json({ limit: "100kb" }));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  await app.listen(3303, "0.0.0.0");
  const instance: unknown = app.getHttpServer();
  if (!isHttpServer(instance)) throw new Error("Expected HTTP server");
  server = instance;
  prisma = app.get(PrismaService);
  inspector = await account("INSPECTOR");
  outsider = await account("INSPECTOR");
  admin = await account("ADMINISTRATOR");
  await seedMatrix();
});

afterAll(async () => {
  await app?.close();
});

describe("verification flow", () => {
  it("генерирует протокол из групп и переводит процесс в READY", async () => {
    const { objectId } = await seedObject();
    const response = await generate(objectId).expect(201);
    const body = response.body as {
      protocol_version: number;
      findings: number;
      reused: boolean;
    };
    expect(body.protocol_version).toBe(1);
    expect(body.findings).toBe(5);
    expect(body.reused).toBe(false);
    const process = await prisma.process.findFirstOrThrow({
      where: { objectId },
    });
    expect(process.status).toBe("READY");
    const protocol = await prisma.protocol.findFirstOrThrow({
      where: { objectId },
      include: { findings: true },
    });
    const byCode = new Map(
      protocol.findings.map((finding) => [finding.parameterCode, finding]),
    );
    expect(byCode.get("P001")?.status).toBe("CANDIDATE");
    expect(byCode.get("P002")?.status).toBe("NEGATIVE_VERIFIED");
    expect(byCode.get("P003")?.status).toBe("CANDIDATE");
    expect(byCode.get("P004")?.status).toBe("MISSING_EVIDENCE");
    expect(byCode.get("P004")?.gateReasons).toEqual(["rule_not_approved"]);
    expect(byCode.get("P005")?.status).toBe("MISSING_EVIDENCE");
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { objectId, action: "protocol.generated" },
    });
    expect(audit.details).toMatchObject({ protocol_version: 1 });
    const outbox = await prisma.outbox.findFirstOrThrow({
      where: { eventType: "protocol.generated" },
    });
    expect(outbox.payload).toMatchObject({ object_id: objectId });
  });

  it("идемпотентна при неизменном наборе находок", async () => {
    const { objectId } = await seedObject();
    await generate(objectId).expect(201);
    const second = await generate(objectId).expect(201);
    expect((second.body as { reused: boolean }).reused).toBe(true);
    expect(await prisma.protocol.count({ where: { objectId } })).toBe(1);
  });

  it("отклоняет доступ постороннему инспектору и generate в PARSING", async () => {
    const { objectId, processId } = await seedObject();
    await generate(objectId, outsider).expect(403);
    await prisma.process.update({
      where: { id: processId },
      data: { status: "PARSING" },
    });
    await generate(objectId).expect(409);
  });

  it("полный цикл: решения → COMPLETED → FINALIZED → отмена администратором", async () => {
    const { objectId, processId } = await seedObject();
    await generate(objectId).expect(201);
    const codes = await candidateCodes(objectId);
    expect(codes.sort()).toEqual(["P001", "P003"]);
    const p001 = await prisma.finding.findFirstOrThrow({
      where: { objectId, parameterCode: "P001" },
    });
    const p003 = await prisma.finding.findFirstOrThrow({
      where: { objectId, parameterCode: "P003" },
    });

    await decide(objectId, p001.id, {
      request_id: randomUUID(),
      action: "confirm",
      finding_version: 99,
    }).expect(409);

    const confirmed = await decide(objectId, p001.id, {
      request_id: randomUUID(),
      action: "confirm",
      finding_version: 1,
      comment: "Совпадает с фактом",
    }).expect(201);
    expect(
      (confirmed.body as { finding: { status: string } }).finding.status,
    ).toBe("CONFIRMED_VIOLATION");
    expect((confirmed.body as { process_status: string }).process_status).toBe(
      "VERIFYING",
    );

    await decide(objectId, p003.id, {
      request_id: randomUUID(),
      action: "reject",
      finding_version: 1,
    }).expect(400);

    const rejected = await decide(objectId, p003.id, {
      request_id: randomUUID(),
      action: "reject",
      finding_version: 1,
      reason_code: "ocr_error",
      comment: "OCR прочитал l вместо II",
    }).expect(201);
    expect((rejected.body as { process_status: string }).process_status).toBe(
      "COMPLETED",
    );

    // COMPLETED: решений нет до финализации или отмены (§9.1).
    await decide(objectId, p001.id, {
      request_id: randomUUID(),
      action: "reopen",
      finding_version: 2,
    }).expect(409);

    await request(server)
      .post(`/api/v1/objects/${objectId}/protocol/finalize`)
      .auth(inspector.token, { type: "bearer" })
      .send({})
      .expect(201);
    const finalized = await prisma.process.findUniqueOrThrow({
      where: { id: processId },
    });
    expect(finalized.status).toBe("FINALIZED");
    await generate(objectId).expect(409);

    await request(server)
      .post(`/api/v1/objects/${objectId}/protocol/finalize/cancel`)
      .auth(inspector.token, { type: "bearer" })
      .send({ reason: "пересмотр" })
      .expect(403);
    await request(server)
      .post(`/api/v1/objects/${objectId}/protocol/finalize/cancel`)
      .auth(admin.token, { type: "bearer" })
      .send({ reason: "" })
      .expect(400);
    await request(server)
      .post(`/api/v1/objects/${objectId}/protocol/finalize/cancel`)
      .auth(admin.token, { type: "bearer" })
      .send({ reason: "Догружен согласованный комплект" })
      .expect(201);
    expect(
      (await prisma.process.findUniqueOrThrow({ where: { id: processId } }))
        .status,
    ).toBe("COMPLETED");
  });

  it("повтор request_id возвращает записанное решение без дубликата", async () => {
    const { objectId } = await seedObject();
    await generate(objectId).expect(201);
    const finding = await prisma.finding.findFirstOrThrow({
      where: { objectId, parameterCode: "P001" },
    });
    const requestId = randomUUID();
    const first = await decide(objectId, finding.id, {
      request_id: requestId,
      action: "confirm",
      finding_version: 1,
      comment: "да",
    }).expect(201);
    const second = await decide(objectId, finding.id, {
      request_id: requestId,
      action: "confirm",
      finding_version: 1,
      comment: "да",
    }).expect(201);
    expect((second.body as { replayed: boolean }).replayed).toBe(true);
    expect(
      await prisma.findingDecision.count({ where: { findingId: finding.id } }),
    ).toBe(1);
    void first;
  });

  it("регенерация: решение переносится по fingerprint, изменённое — сбрасывается", async () => {
    const { objectId, processId } = await seedObject();
    await generate(objectId).expect(201);
    const p001 = await prisma.finding.findFirstOrThrow({
      where: { objectId, parameterCode: "P001" },
    });
    const p003 = await prisma.finding.findFirstOrThrow({
      where: { objectId, parameterCode: "P003" },
    });
    await decide(objectId, p001.id, {
      request_id: randomUUID(),
      action: "confirm",
      finding_version: 1,
      comment: "подтверждено",
    }).expect(201);
    await decide(objectId, p003.id, {
      request_id: randomUUID(),
      action: "reject",
      finding_version: 1,
      reason_code: "approved_change",
      comment: "согласовано изменение",
    }).expect(201);

    // Меняем evidence только P001: решение не наследуется (§9.3).
    await prisma.evidenceGroup.updateMany({
      where: { objectId, parameterCode: "P001" },
      data: {
        members: [
          {
            extraction_id: randomUUID(),
            file_id: randomUUID(),
            stage: "PD",
            role: "expected",
            status: "extracted",
            value: 100,
            value_raw: "100",
            unit: "m2",
          },
          {
            extraction_id: randomUUID(),
            file_id: randomUUID(),
            stage: "RD",
            role: "actual",
            status: "extracted",
            value: 999,
            value_raw: "999",
            unit: "m2",
          },
        ],
      },
    });
    const second = await generate(objectId).expect(201);
    expect((second.body as { protocol_version: number }).protocol_version).toBe(
      2,
    );
    const protocols = await prisma.protocol.findMany({
      where: { objectId },
      orderBy: { version: "asc" },
      include: { findings: true },
    });
    expect(protocols[0]?.status).toBe("superseded");
    expect(protocols[1]?.status).toBe("active");
    const v2 = new Map(
      protocols[1]!.findings.map((finding) => [finding.parameterCode, finding]),
    );
    expect(v2.get("P001")?.status).toBe("CANDIDATE");
    expect(v2.get("P001")?.decidedBy).toBeNull();
    expect(v2.get("P003")?.status).toBe("NEGATIVE_VERIFIED");
    expect(v2.get("P003")?.decidedBy).toBe(inspector.id);
    expect(
      await prisma.findingDecision.count({
        where: { findingId: v2.get("P003")!.id },
      }),
    ).toBe(1);
    const process = await prisma.process.findUniqueOrThrow({
      where: { id: processId },
    });
    expect(process.status).toBe("READY");
  });
});
