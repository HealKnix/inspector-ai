import SwaggerParser from "@apidevtools/swagger-parser";
import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { OpenAPIObject } from "@nestjs/swagger";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Ajv } from "ajv";
import { connect } from "amqplib";
import { json } from "express";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  access as fileExists,
  mkdir,
  readdir,
  readFile,
  utimes,
  writeFile,
} from "node:fs/promises";
import { createServer, request as httpRequest, Server } from "node:http";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import pg from "pg";
import "reflect-metadata";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import { OutboxService } from "../src/infrastructure/rabbitmq/outbox.service.js";
import { FileSafetyService } from "../src/infrastructure/storage/file-safety.service.js";
import { PrivateStorageService } from "../src/infrastructure/storage/private-storage.service.js";
import { AuthService } from "../src/modules/auth/auth.service.js";
import { canonicalJson } from "../src/modules/documents/canonical-json.js";
import { DocumentAdmissionService } from "../src/modules/documents/document-admission.service.js";
import { IntegrityService } from "../src/modules/documents/integrity.service.js";
import { receiveUpload } from "../src/modules/documents/upload-stream.js";
import { ObjectAccessService } from "../src/modules/objects/object-access.service.js";
import { syntheticDocx, syntheticPdf } from "./fixtures.js";
import { streamedPackage } from "./streamed-package.js";

// Only this disposable local PostgreSQL is used. Existing application databases are untouched.
const dbName = "ingestion_" + randomUUID().replaceAll("-", "");
const databaseUrl =
  "postgresql://postgres:ingestion-test-only@127.0.0.1:25432/" + dbName;
const root = resolve("../.test-output/storage");
const broker = "amqp://guest:guest@127.0.0.1:25672";
const config = {
  DATABASE_URL: databaseUrl,
  STORAGE_ROOT: root,
  CLAMAV_HOST: "127.0.0.1",
  CLAMAV_PORT: 23310,
  FILE_VALIDATOR_URL: "http://127.0.0.1:28081",
  RABBITMQ_URL: broker,
};
let app: INestApplication;
let server: Server;
let prisma: PrismaService;
let access: ObjectAccessService;
let storage: PrivateStorageService;
let inspector: { id: string; token: string };
let outsider: { id: string; token: string };
let admin: { id: string; token: string };
let noRole: { id: string; token: string };
function isHttpServer(value: unknown): value is Server {
  return value instanceof Server;
}

async function account(
  role: "INSPECTOR" | "ADMINISTRATOR" | "ML_ENGINEER" | null,
) {
  const session = await app
    .get(AuthService)
    .register("synthetic-" + randomUUID().slice(0, 8), "Test-password-123!");
  await prisma.user.update({
    where: { id: session.user.id },
    data: { role },
  });
  return { id: session.user.id, token: session.accessToken };
}
async function createObject(user = inspector) {
  const response = await request(server)
    .post("/api/v1/objects")
    .auth(user.token, { type: "bearer" })
    .send({ name: "Синтетический объект" })
    .expect(201);
  return (response.body as { id: string }).id;
}
function uploadBody(
  objectId: string,
  contents = Buffer.from("<synthetic/>"),
  name = "../synthetic.xml",
) {
  return {
    object_id: objectId,
    client_upload_id: randomUUID(),
    files: [
      {
        client_file_id: randomUUID(),
        original_name: name,
        content_base64: contents.toString("base64"),
      },
    ],
  };
}
function upload(body: ReturnType<typeof uploadBody>, user = inspector) {
  return request(server)
    .post("/api/v1/documents/upload")
    .auth(user.token, { type: "bearer" })
    .send(body);
}
interface Receipt {
  process_id: string | null;
  run_id: string | null;
  files: {
    accepted: boolean;
    file_id: string;
    error?: string;
    existing_file_id?: string;
    message?: string;
  }[];
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
    ...config,
    CLAMAV_PORT: "23310",
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
  const parser = json({ limit: "100kb" });
  app.use(
    (
      req: import("express").Request,
      res: import("express").Response,
      next: import("express").NextFunction,
    ) => {
      if (req.path === "/api/v1/documents/upload") next();
      else parser(req, res, next);
    },
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  await app.listen(3302, "0.0.0.0");
  const instance: unknown = app.getHttpServer();
  if (!isHttpServer(instance)) throw new Error("Expected HTTP server");
  server = instance;
  prisma = app.get(PrismaService);
  access = app.get(ObjectAccessService);
  storage = app.get(PrivateStorageService);
  inspector = await account("INSPECTOR");
  outsider = await account("INSPECTOR");
  admin = await account("ADMINISTRATOR");
  noRole = await account(null);
  await mkdir(resolve("../.test-output"), { recursive: true });
  await writeFile(
    resolve("../.test-output/openapi.json"),
    JSON.stringify(
      SwaggerModule.createDocument(
        app,
        new DocumentBuilder()
          .setTitle("Ingestion")
          .setVersion("1")
          .addBearerAuth(undefined, "access-token")
          .build(),
      ),
      null,
      2,
    ),
  );
  await SwaggerParser.validate(resolve("../.test-output/openapi.json"));
  const contract = (await SwaggerParser.dereference(
    resolve("../.test-output/openapi.json"),
  )) as OpenAPIObject;
  const ajv = new Ajv({ strict: false, validateFormats: false });
  for (const path of Object.values(contract.paths)) {
    for (const operation of [path?.get, path?.post]) {
      for (const response of Object.values(operation?.responses ?? {})) {
        if (!response || !("content" in response)) continue;
        for (const media of Object.values(response.content ?? {})) {
          const schema = media.schema;
          if (!schema || "$ref" in schema) continue;
          const example: unknown = media.example ?? schema.example;
          if (example === undefined) continue;
          const validate = ajv.compile(schema);
          expect(validate(example), JSON.stringify(validate.errors)).toBe(true);
        }
      }
    }
  }
});

afterAll(async () => {
  await app?.close();
  // Retained for evidence and optional browser QA, contains synthetic fixtures only.
  await writeFile(resolve("../.test-output/integration-database.txt"), dbName);
});

describe("real admission dependencies", () => {
  it("creates from an empty registry, scopes lists and forbids self-assignment/null roles", async () => {
    const empty = await request(server)
      .get("/api/v1/objects")
      .auth(inspector.token, { type: "bearer" })
      .expect(200);
    expect((empty.body as { items: unknown[] }).items).toHaveLength(0);
    const id = await createObject();
    expect(
      await prisma.objectAccess.count({
        where: { objectId: id, userId: inspector.id },
      }),
    ).toBe(1);
    await request(server)
      .get("/api/v1/objects/" + id)
      .auth(outsider.token, { type: "bearer" })
      .expect(403);
    await request(server)
      .get("/api/v1/objects")
      .auth(noRole.token, { type: "bearer" })
      .expect(403);
    const ml = await account("ML_ENGINEER");
    await request(server)
      .get("/api/v1/objects")
      .auth(ml.token, { type: "bearer" })
      .expect(403);
    await expect(
      access.setAssignment(
        { userId: admin.id, requestId: randomUUID() },
        id,
        ml.id,
        true,
      ),
    ).rejects.toThrow();
    await request(server)
      .post("/api/v1/objects")
      .auth(admin.token, { type: "bearer" })
      .send({ name: "x" })
      .expect(403);
    await request(server)
      .post("/api/v1/objects")
      .auth(inspector.token, { type: "bearer" })
      .send({ name: "x", user_id: outsider.id })
      .expect(400);
    await expect(
      prisma.objectAccess.create({
        data: {
          objectId: randomUUID(),
          userId: inspector.id,
          grantedBy: admin.id,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.objectAccess.create({
        data: { objectId: id, userId: "missing-user", grantedBy: admin.id },
      }),
    ).rejects.toThrow();
  });

  it("accepts real PDF/DOCX/XML, rejects damage/XXE/embedded content individually, verifies original hash and RabbitMQ", async () => {
    const objectId = await createObject();
    const body = uploadBody(objectId);
    const contents = [
      Buffer.from("<synthetic/>"),
      syntheticPdf(),
      syntheticDocx(),
      Buffer.from("%PDF-1.7 broken"),
      Buffer.from(
        '<!DOCTYPE x [<!ENTITY e SYSTEM "http://invalid.example/leak">]><x>&e;</x>',
      ),
      syntheticDocx({
        "word/embeddings/payload.exe": "synthetic executable placeholder",
      }),
      Buffer.from("Synthetic unsupported bytes disguised by a PDF filename"),
    ];
    body.files = contents.map((content, i) => ({
      client_file_id: randomUUID(),
      original_name: "synthetic-" + i + ".pdf",
      content_base64: content.toString("base64"),
    }));
    const response = await upload(body).expect(202);
    const receipt = response.body as Receipt;
    expect(receipt.files.map((file) => file.accepted)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    const file = await prisma.file.findUniqueOrThrow({
      where: { id: receipt.files[0]!.file_id },
    });
    expect(file.objectId).toBe(objectId);
    expect(file.processId).toBe(receipt.process_id);
    const savedRun = await prisma.run.findUniqueOrThrow({
      where: { id: receipt.run_id! },
    });
    expect(
      createHash("sha256")
        .update(canonicalJson(savedRun.inputManifest))
        .digest("hex"),
    ).toBe(savedRun.inputManifestHash);
    const processResponse = await request(server)
      .get(`/api/v1/processes/${receipt.process_id}`)
      .auth(inspector.token, { type: "bearer" })
      .expect(200);
    expect(processResponse.body).toMatchObject({
      object_id: objectId,
      process_id: receipt.process_id,
      run_id: receipt.run_id,
      status: "PENDING",
      allowed_actions: ["upload"],
    });
    expect(await storage.hash(file.storageKey)).toBe(
      createHash("sha256").update(contents[0]!).digest("hex"),
    );
    await request(server)
      .get(`/api/v1/objects/${objectId}/files/${file.id}/original`)
      .auth(inspector.token, { type: "bearer" })
      .expect(200);
    await request(server)
      .get(`/api/v1/objects/${objectId}/files/${file.id}/original`)
      .auth(outsider.token, { type: "bearer" })
      .expect(403);
    const dispatcher = new OutboxService(prisma, new ConfigService(config));
    for (
      let attempt = 0;
      attempt < 10 && (await dispatcher.dispatchOne());
      attempt++
    ) {
      /* Drain committed events. */
    }
    expect(
      await prisma.outbox.count({
        where: { job: { runId: receipt.run_id! }, deliveredAt: { not: null } },
      }),
    ).toBe(1);
    const connection = await connect(broker);
    const channel = await connection.createChannel();
    const queue = await channel.checkQueue("inspector.documents.accepted");
    expect(queue.messageCount).toBeGreaterThan(0);
    await connection.close();
    await expect(
      prisma.file.update({
        where: { id: file.id },
        data: { objectId: randomUUID() },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.run.update({
        where: { id: receipt.run_id! },
        data: { inputManifestHash: "0".repeat(64) },
      }),
    ).rejects.toThrow();
  });

  it("accepts a PDF with recoverable qpdf warnings and preserves its original bytes", async () => {
    const objectId = await createObject();
    const contents = syntheticPdf({ sizeWarning: true });
    const body = uploadBody(objectId, contents, "synthetic-warning.pdf");
    const response = await upload(body).expect(202);
    const receipt = response.body as Receipt;
    expect(receipt.files).toHaveLength(1);
    expect(receipt.files[0]?.accepted).toBe(true);
    const file = await prisma.file.findUniqueOrThrow({
      where: { id: receipt.files[0]!.file_id },
    });
    expect(file.format).toBe("PDF");
    const original = await request(server)
      .get(`/api/v1/objects/${objectId}/files/${file.id}/original`)
      .auth(inspector.token, { type: "bearer" })
      .expect(200);
    expect(original.body).toEqual(contents);
    expect(await storage.hash(file.storageKey)).toBe(
      createHash("sha256").update(contents).digest("hex"),
    );
  });

  it.each([false, true])(
    "rejects active PDF content even when qpdf warnings are allowed (warning=%s)",
    async (sizeWarning) => {
      const objectId = await createObject();
      const body = uploadBody(
        objectId,
        syntheticPdf({ sizeWarning, activeContent: true }),
        "synthetic-active.pdf",
      );
      const response = await upload(body).expect(422);
      expect(response.body).toMatchObject({
        process_id: null,
        files: [{ accepted: false, error: "unsafe_format" }],
      });
      expect(await prisma.file.count({ where: { objectId } })).toBe(0);
    },
  );

  it("does not admit or enqueue a file when the structural validator returns HTTP 503", async () => {
    const objectId = await createObject();
    const runtimeConfig = app.get(ConfigService);
    const originalValidatorUrl =
      runtimeConfig.getOrThrow<string>("FILE_VALIDATOR_URL");
    let validatorRequests = 0;
    const unavailableValidator = createServer((req, res) => {
      validatorRequests++;
      req.resume();
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "validator_unavailable" }));
    });
    await new Promise<void>((resolve, reject) => {
      unavailableValidator.once("error", reject);
      unavailableValidator.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = unavailableValidator.address();
      if (!address || typeof address === "string")
        throw new Error("Expected local validator test address");
      runtimeConfig.set(
        "FILE_VALIDATOR_URL",
        `http://127.0.0.1:${address.port}`,
      );

      // The real adapter still performs ClamAV before this local HTTP response.
      const response = await upload(
        uploadBody(objectId, syntheticPdf(), "synthetic-validator-timeout.pdf"),
      ).expect(422);
      expect(validatorRequests).toBe(1);
      expect(response.body).toMatchObject({
        process_id: null,
        run_id: null,
        files: [{ accepted: false, error: "validator_unavailable" }],
      });
      const persistedCounts = await Promise.all([
        prisma.file.count({ where: { objectId } }),
        prisma.process.count({ where: { objectId } }),
        prisma.run.count({ where: { objectId } }),
        prisma.parsingTask.count({ where: { objectId } }),
        prisma.job.count({ where: { objectId } }),
        prisma.outbox.count({ where: { job: { objectId } } }),
      ]);
      expect(persistedCounts).toEqual([0, 0, 0, 0, 0, 0]);
    } finally {
      runtimeConfig.set("FILE_VALIDATOR_URL", originalValidatorUrl);
      await new Promise<void>((resolve, reject) => {
        unavailableValidator.close((error) =>
          error ? reject(error) : resolve(),
        );
        unavailableValidator.closeAllConnections();
      });
    }
  });

  it("replays concurrently, rejects a changed key, checks access on replay and process ownership", async () => {
    const objectId = await createObject();
    const body = uploadBody(objectId);
    const [a, b] = await Promise.all([upload(body), upload(body)]);
    expect(a.status).toBe(202);
    expect(b.body).toEqual(a.body);
    const receipt = a.body as Receipt;
    expect(await prisma.process.count({ where: { objectId } })).toBe(1);
    await prisma.process.update({
      where: { id: receipt.process_id! },
      data: { status: "PARSING" },
    });
    expect((await upload(body).expect(202)).body).toEqual(a.body);
    await upload({
      ...body,
      files: [
        {
          ...body.files[0]!,
          content_base64: Buffer.from("<changed/>").toString("base64"),
        },
      ],
    }).expect(409);
    await upload({
      ...uploadBody(objectId),
      process_id: receipt.process_id,
    } as ReturnType<typeof uploadBody>).expect(409);
    const otherObject = await createObject();
    await upload({
      ...uploadBody(otherObject),
      process_id: receipt.process_id,
    } as ReturnType<typeof uploadBody>).expect(409);
    await access.setAssignment(
      { userId: admin.id, requestId: randomUUID() },
      objectId,
      inspector.id,
      false,
    );
    await upload(body).expect(403);
    await request(server)
      .get(`/api/v1/objects/${objectId}/uploads/${body.client_upload_id}`)
      .auth(inspector.token, { type: "bearer" })
      .expect(403);
    await access.setAssignment(
      { userId: admin.id, requestId: randomUUID() },
      objectId,
      inspector.id,
      true,
    );
    await access.setAssignment(
      { userId: admin.id, requestId: randomUUID() },
      objectId,
      inspector.id,
      true,
    );
    expect(
      await prisma.objectAccess.count({
        where: { objectId, userId: inspector.id },
      }),
    ).toBe(1);
  });

  it.each(["READY", "VERIFYING", "COMPLETED"] as const)(
    "returns a new input Run to PENDING after an upload from %s",
    async (previousStatus) => {
      const objectId = await createObject();
      const accepted = (await upload(uploadBody(objectId)).expect(202))
        .body as Receipt;
      await prisma.process.update({
        where: { id: accepted.process_id! },
        data: { status: previousStatus },
      });
      const next = (
        await upload({
          ...uploadBody(
            objectId,
            Buffer.from(`<additional id="${randomUUID()}"/>`),
          ),
          process_id: accepted.process_id,
        } as ReturnType<typeof uploadBody>).expect(202)
      ).body as Receipt;
      expect(next.process_id).toBe(accepted.process_id);
      expect(next.run_id).not.toBe(accepted.run_id);
      expect(
        await prisma.process.findUniqueOrThrow({
          where: { id: accepted.process_id! },
        }),
      ).toMatchObject({ status: "PENDING", version: 2 });
      expect(
        await prisma.runInput.count({ where: { runId: accepted.run_id! } }),
      ).toBe(1);
      expect(
        await prisma.runInput.count({ where: { runId: next.run_id! } }),
      ).toBe(2);
      expect(await prisma.file.count({ where: { objectId } })).toBe(2);
    },
  );

  it("skips identical content across new keys/users/names and mixed packages without another job or copy", async () => {
    const objectId = await createObject();
    const first = (await upload(uploadBody(objectId)).expect(202))
      .body as Receipt;
    const existingId = first.files[0]!.file_id;
    const originals = await readdir(storage.root + "/originals");
    await access.setAssignment(
      { userId: admin.id, requestId: randomUUID() },
      objectId,
      outsider.id,
      true,
    );
    const body = uploadBody(
      objectId,
      Buffer.from("<synthetic/>"),
      "renamed.xml",
    );
    const duplicate = (await upload(body, outsider).expect(422))
      .body as Receipt;
    expect(duplicate).toMatchObject({
      process_id: null,
      run_id: null,
      files: [
        {
          accepted: false,
          error: "duplicate_file",
          existing_file_id: existingId,
        },
      ],
    });
    expect((await upload(body, outsider).expect(422)).body).toEqual(duplicate);
    expect(
      (
        await request(server)
          .get(`/api/v1/objects/${objectId}/uploads/${body.client_upload_id}`)
          .auth(outsider.token, { type: "bearer" })
          .expect(200)
      ).body,
    ).toEqual(duplicate);
    expect(await readdir(storage.root + "/originals")).toEqual(originals);
    expect(await prisma.file.count({ where: { objectId } })).toBe(1);
    expect(await prisma.process.count({ where: { objectId } })).toBe(1);
    expect(await prisma.run.count({ where: { objectId } })).toBe(1);
    expect(await prisma.job.count({ where: { objectId } })).toBe(1);
    expect(await prisma.outbox.count({ where: { job: { objectId } } })).toBe(1);

    const mixed = uploadBody(objectId);
    mixed.files.push(uploadBody(objectId, Buffer.from("<changed/>")).files[0]!);
    mixed.files.push({
      ...mixed.files[1]!,
      client_file_id: randomUUID(),
      original_name: "copy.xml",
    });
    const result = (await upload(mixed).expect(202)).body as Receipt;
    expect(result.files.map((file) => file.accepted)).toEqual([
      false,
      true,
      false,
    ]);
    expect(result.files[0]!.existing_file_id).toBe(existingId);
    expect(result.files[2]!.existing_file_id).toBe(result.files[1]!.file_id);
    expect(await prisma.file.count({ where: { objectId } })).toBe(2);
    expect(await prisma.job.count({ where: { objectId } })).toBe(2);
    expect(
      await prisma.runInput.count({ where: { runId: result.run_id! } }),
    ).toBe(1);
    expect((await readdir(storage.root + "/originals")).length).toBe(
      originals.length + 1,
    );
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { objectId, action: "documents.admission", userId: outsider.id },
    });
    expect(audit.details).toMatchObject({
      accepted: 0,
      duplicates: 1,
      rejected: 0,
    });
    const file = await prisma.file.findUniqueOrThrow({
      where: { id: existingId },
    });
    await expect(
      prisma.file.create({
        data: { ...file, id: randomUUID(), storageKey: randomUUID() },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.objectFileContent.delete({
        where: { objectId_sha256: { objectId, sha256: file.sha256 } },
      }),
    ).rejects.toThrow();
    await access.setAssignment(
      { userId: admin.id, requestId: randomUUID() },
      objectId,
      outsider.id,
      false,
    );
    await upload(uploadBody(objectId), outsider).expect(403);
    await request(server)
      .get(`/api/v1/objects/${objectId}/files/${existingId}/original`)
      .auth(outsider.token, { type: "bearer" })
      .expect(403);
  });

  it("serializes different upload keys for the same new content and removes the losing physical copy", async () => {
    const objectId = await createObject();
    const originals = await readdir(storage.root + "/originals");
    const publish = storage.publish.bind(storage);
    let ready = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi.spyOn(storage, "publish").mockImplementation(async (key) => {
      const result = await publish(key);
      if (++ready === 2) release();
      await barrier;
      return result;
    });
    try {
      const [a, b] = await Promise.all([
        upload(uploadBody(objectId)),
        upload(uploadBody(objectId)),
      ]);
      expect([a.status, b.status].sort()).toEqual([202, 422]);
      const accepted = (a.status === 202 ? a.body : b.body) as Receipt;
      const duplicate = (a.status === 422 ? a.body : b.body) as Receipt;
      expect(duplicate.files[0]!.existing_file_id).toBe(
        accepted.files[0]!.file_id,
      );
      expect(await prisma.file.count({ where: { objectId } })).toBe(1);
      expect(await prisma.process.count({ where: { objectId } })).toBe(1);
      expect(await prisma.job.count({ where: { objectId } })).toBe(1);
      expect(await prisma.uploadReceipt.count({ where: { objectId } })).toBe(2);
      expect((await readdir(storage.root + "/originals")).length).toBe(
        originals.length + 1,
      );
    } finally {
      release();
      spy.mockRestore();
    }
  });

  it("backfills a database with historical duplicates without changing files or run history", async () => {
    const objectId = await createObject();
    const receipt = (await upload(uploadBody(objectId)).expect(202))
      .body as Receipt;
    const firstId = receipt.files[0]!.file_id;
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    await client.query("BEGIN");
    try {
      // Recreate the pre-migration state in this disposable transaction only.
      await client.query(
        "DROP TRIGGER register_file_content ON files; DROP FUNCTION register_object_file_content(); DROP TABLE object_file_contents; DROP INDEX files_id_object_id_sha256_key",
      );
      await client.query(
        `INSERT INTO files (id, object_id, process_id, run_id, original_name, format, size, sha256, storage_key, uploaded_by, created_at)
        SELECT $1, object_id, process_id, run_id, original_name, format, size, sha256, $2, uploaded_by, created_at + interval '1 second' FROM files WHERE id = $3`,
        [randomUUID(), randomUUID(), firstId],
      );
      const sql = await readFile(
        resolve(
          "prisma/migrations/20260918010000_deduplicate_object_files/migration.sql",
        ),
        "utf8",
      );
      await client.query(sql.replace(/^BEGIN;/, "").replace(/COMMIT;\s*$/, ""));
      const canonical = await client.query<{ file_id: string }>(
        "SELECT file_id FROM object_file_contents WHERE object_id=$1",
        [objectId],
      );
      expect(canonical.rows).toEqual([{ file_id: firstId }]);
      const count = await client.query<{ count: string }>(
        "SELECT count(*) FROM files WHERE object_id=$1",
        [objectId],
      );
      expect(count.rows[0]!.count).toBe("2");
      const inputs = await client.query<{ file_id: string }>(
        "SELECT file_id FROM run_inputs WHERE run_id=$1",
        [receipt.run_id],
      );
      expect(inputs.rows).toEqual([{ file_id: firstId }]);
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
  });

  it("denies infected input and scanner outages; all-refused packages create no process", async () => {
    const objectId = await createObject();
    // EICAR is the standard harmless antivirus test string, confined to disposable quarantine.
    const eicar = Buffer.from(
      "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
    );
    const denied = await upload(uploadBody(objectId, eicar)).expect(422);
    expect((denied.body as Receipt).files[0]?.error).toBe("infected");
    expect(await prisma.process.count({ where: { objectId } })).toBe(0);
    const temp = await storage.temporary();
    await temp.handle.write(Buffer.from("<test/>"));
    await temp.handle.close();
    const unavailable = new FileSafetyService(
      new ConfigService({ ...config, CLAMAV_PORT: 23311 }),
      storage,
    );
    expect(await unavailable.inspect(temp.key)).toMatchObject({
      error: "scanner_unavailable",
    });
    await storage.discard(temp.key);
  });

  it("detects original corruption without changing the recorded hash and emits a durable event", async () => {
    const objectId = await createObject();
    const response = await upload(uploadBody(objectId)).expect(202);
    const receipt = response.body as Receipt;
    const file = await prisma.file.findUniqueOrThrow({
      where: { id: receipt.files[0]!.file_id },
    });
    await writeFile(
      storage.path("originals", file.storageKey),
      "synthetic corruption",
    );
    const integrity = new IntegrityService(prisma, storage);
    for (let i = 0; i < 20 && (await integrity.checkOne()); i++) {
      /* Checks all currently due originals. */
    }
    const changed = await prisma.file.findUniqueOrThrow({
      where: { id: file.id },
    });
    expect(changed.sha256).toBe(file.sha256);
    expect(changed.corruptedAt).not.toBeNull();
    const repeated = (await upload(uploadBody(objectId)).expect(422))
      .body as Receipt;
    expect(repeated.files[0]).toMatchObject({
      error: "duplicate_file",
      existing_file_id: file.id,
    });
    expect(repeated.files[0]!.message).toContain("целостность");
    expect(await prisma.file.count({ where: { objectId } })).toBe(1);
    expect(
      await prisma.outbox.count({
        where: { eventType: "file.integrity-failed" },
      }),
    ).toBeGreaterThan(0);
    await request(server)
      .get(`/api/v1/objects/${objectId}/files/${file.id}/original`)
      .auth(inspector.token, { type: "bearer" })
      .expect(503);
  });

  it("keeps durable outbox on broker outage and delivers after recovery", async () => {
    const objectId = await createObject();
    await upload(uploadBody(objectId)).expect(202);
    const before = await prisma.outbox.count({ where: { deliveredAt: null } });
    const failed = new OutboxService(
      prisma,
      new ConfigService({ RABBITMQ_URL: "amqp://guest:guest@127.0.0.1:25674" }),
    );
    await failed.dispatchOne();
    expect(await prisma.outbox.count({ where: { deliveredAt: null } })).toBe(
      before,
    );
    await prisma.outbox.updateMany({
      where: { deliveredAt: null },
      data: { availableAt: new Date(0) },
    });
    const recovered = new OutboxService(prisma, new ConfigService(config));
    for (let i = 0; i < 20 && (await recovered.dispatchOne()); i++) {
      /* Drain pending synthetic events. */
    }
    expect(await prisma.outbox.count({ where: { deliveredAt: null } })).toBe(0);
  });
  it("isolates identical bytes on two objects and enforces composite foreign keys", async () => {
    const left = await createObject();
    const right = await createObject(outsider);
    const a = (await upload(uploadBody(left)).expect(202)).body as Receipt;
    const b = (await upload(uploadBody(right), outsider).expect(202))
      .body as Receipt;
    const first = await prisma.file.findUniqueOrThrow({
      where: { id: a.files[0]!.file_id },
    });
    const second = await prisma.file.findUniqueOrThrow({
      where: { id: b.files[0]!.file_id },
    });
    expect(first.sha256).toBe(second.sha256);
    expect(first.id).not.toBe(second.id);
    expect(first.storageKey).not.toBe(second.storageKey);
    await upload(uploadBody(right)).expect(403);
    await request(server)
      .get(`/api/v1/objects/${left}/files/${second.id}/original`)
      .auth(inspector.token, { type: "bearer" })
      .expect(404);
    await request(server)
      .post("/api/v1/documents/upload")
      .auth(inspector.token, { type: "bearer" })
      .send({ client_upload_id: randomUUID(), files: uploadBody(left).files })
      .expect(400);
    await expect(
      prisma.file.create({
        data: {
          ...first,
          id: randomUUID(),
          storageKey: randomUUID(),
          objectId: right,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.runInput.create({
        data: {
          runId: a.run_id!,
          processId: a.process_id!,
          objectId: left,
          fileId: second.id,
        },
      }),
    ).rejects.toThrow();
  });

  it("cleans an interrupted HTTP body and recovers a committed response after disconnect", async () => {
    const objectId = await createObject();
    const before = (await readdir(storage.root + "/quarantine")).sort();
    const interrupted = httpRequest(
      "http://127.0.0.1:3302/api/v1/documents/upload",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + inspector.token,
        },
      },
    );
    interrupted.on("error", () => {
      /* Expected client-side disconnect. */
    });
    interrupted.write(
      JSON.stringify(uploadBody(objectId)).replace(
        /content_base64.*$/,
        'content_base64":"',
      ),
    );
    interrupted.write("YWFh".repeat(30_000));
    await expect
      .poll(async () => (await readdir(storage.root + "/quarantine")).length)
      .toBeGreaterThan(before.length);
    interrupted.destroy();
    await expect
      .poll(async () => (await readdir(storage.root + "/quarantine")).sort())
      .toEqual(before);
    expect(await prisma.process.count({ where: { objectId } })).toBe(0);

    const body = uploadBody(objectId);
    await new Promise<void>((resolveResponse, reject) => {
      const req = httpRequest(
        "http://127.0.0.1:3302/api/v1/documents/upload",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + inspector.token,
          },
        },
        (res) => {
          res.destroy();
          resolveResponse();
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify(body));
    });
    const receipt = await request(server)
      .get(`/api/v1/objects/${objectId}/uploads/${body.client_upload_id}`)
      .auth(inspector.token, { type: "bearer" })
      .expect(200);
    expect((await upload(body).expect(202)).body).toEqual(receipt.body);
    expect(await prisma.process.count({ where: { objectId } })).toBe(1);
    expect(await prisma.file.count({ where: { objectId } })).toBe(1);
  });

  it("preserves atomicity on storage/DB failure and collects only stale unreferenced originals", async () => {
    const objectId = await createObject();
    const body = uploadBody(objectId);
    const input = await receiveUpload(
      Readable.from([JSON.stringify(body)]),
      storage,
      AbortSignal.timeout(30_000),
    );
    const failedRoot = resolve("../.test-output/storage-failure", randomUUID());
    await mkdir(failedRoot, { recursive: true });
    await writeFile(
      failedRoot + "/originals",
      "synthetic unavailable directory",
    );
    const failedStorage = new PrivateStorageService(
      new ConfigService({ STORAGE_ROOT: failedRoot }),
    );
    const service = new DocumentAdmissionService(
      prisma,
      access,
      failedStorage,
      app.get(FileSafetyService),
    );
    const session = await prisma.authSession.findFirstOrThrow({
      where: { userId: inspector.id, revokedAt: null },
    });
    await expect(
      service.accept(
        { userId: inspector.id, requestId: randomUUID() },
        input,
        Date.now() + 60_000,
        session.id,
      ),
    ).rejects.toThrow();
    await Promise.all(input.files.map((file) => storage.discard(file.key)));
    expect(await prisma.process.count({ where: { objectId } })).toBe(0);
    expect(await prisma.uploadReceipt.count({ where: { objectId } })).toBe(0);

    const originals = new Set(await readdir(storage.root + "/originals"));
    await prisma.$executeRawUnsafe(
      "CREATE FUNCTION synthetic_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic commit failure'; END $$",
    );
    await prisma.$executeRawUnsafe(
      "CREATE TRIGGER synthetic_failure BEFORE INSERT ON upload_receipts FOR EACH ROW EXECUTE FUNCTION synthetic_receipt_failure()",
    );
    try {
      await upload(body).expect(503);
    } finally {
      await prisma.$executeRawUnsafe(
        "DROP TRIGGER synthetic_failure ON upload_receipts",
      );
      await prisma.$executeRawUnsafe(
        "DROP FUNCTION synthetic_receipt_failure()",
      );
    }
    expect(await prisma.process.count({ where: { objectId } })).toBe(0);
    expect(await prisma.job.count({ where: { objectId } })).toBe(0);
    const orphan = (await readdir(storage.root + "/originals")).find(
      (key) => !originals.has(key),
    )!;
    expect(orphan).toBeTruthy();
    const accepted = (await upload(body).expect(202)).body as Receipt;
    const file = await prisma.file.findUniqueOrThrow({
      where: { id: accepted.files[0]!.file_id },
    });
    const stale = new Date(Date.now() - 90_000_000);
    await utimes(storage.path("originals", orphan), stale, stale);
    await utimes(storage.path("originals", file.storageKey), stale, stale);
    // Other databases share this disposable volume; only this test's handles are candidates.
    await storage.cleanup(
      "originals",
      async (key) =>
        key !== orphan ||
        (await prisma.file.count({ where: { storageKey: key } })) > 0,
    );
    await expect(
      fileExists(storage.path("originals", orphan)),
    ).rejects.toThrow();
    expect(await storage.hash(file.storageKey)).toBe(file.sha256);
    expect(
      await prisma.outbox.count({
        where: { job: { runId: accepted.run_id! } },
      }),
    ).toBe(1);
  });

  it("passes an exact 200 MB package through the production Nginx route and rejects +1 byte", async () => {
    const objectId = await createObject();
    async function send(sizes: number[]) {
      const response = new Promise<{ status: number; body: Receipt }>(
        (resolveResponse, reject) => {
          const req = httpRequest(
            "http://127.0.0.1:28080/api/v1/documents/upload",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + inspector.token,
              },
            },
            (res) => {
              const parts: Buffer[] = [];
              res.on("data", (part: Buffer) => parts.push(part));
              res.on("end", () => {
                try {
                  resolveResponse({
                    status: res.statusCode ?? 0,
                    body: JSON.parse(
                      Buffer.concat(parts).toString(),
                    ) as Receipt,
                  });
                } catch (error) {
                  reject(
                    error instanceof Error
                      ? error
                      : new Error("Invalid test response"),
                  );
                }
              });
              res.on("error", reject);
            },
          );
          req.on("error", reject);
          void pipeline(
            Readable.from(streamedPackage(objectId, randomUUID(), sizes)),
            req,
          ).catch(reject);
        },
      );
      return response;
    }
    const accepted = await send([
      50_000_000, 50_000_000, 50_000_000, 50_000_000,
    ]);
    expect(accepted.status).toBe(202);
    expect(accepted.body.files.map((file) => file.accepted)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    const before = await prisma.file.count({ where: { objectId } });
    expect(
      (await send([50_000_000, 50_000_000, 50_000_000, 50_000_001])).status,
    ).toBe(413);
    expect(await prisma.file.count({ where: { objectId } })).toBe(before);
    const oversized = await send([50_000_001]);
    expect(oversized.status).toBe(422);
    expect(oversized.body.files[0]?.error).toBe("file_too_large");
  }, 180_000);
});
