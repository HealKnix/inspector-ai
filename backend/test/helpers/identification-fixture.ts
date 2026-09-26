import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import pg from "pg";
import "reflect-metadata";
import request from "supertest";
import { PrismaService } from "../../src/infrastructure/prisma/prisma.service.js";
import { PrivateStorageService } from "../../src/infrastructure/storage/private-storage.service.js";
import { AuthService } from "../../src/modules/auth/auth.service.js";
import { canonicalJson } from "../../src/modules/documents/canonical-json.js";
import type { ClassificationResult } from "../../src/modules/identification/classification-contract.js";
import type {
  ClarificationBatch,
  IdentificationSnapshot,
} from "../../src/modules/identification/identification-contract.js";
import type { DocumentAlias } from "../../src/modules/identification/identification-grouping.js";
import { IdentificationJobsService } from "../../src/modules/identification/identification-jobs.service.js";
import { identificationJson } from "../../src/modules/identification/identification-state.js";
import { ArtifactStorageService } from "../../src/modules/parsing/artifact-storage.service.js";
import type { ParseArtifactData } from "../../src/modules/parsing/parsing-contract.js";

export const fixtureParserFingerprint = "d".repeat(64);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j/qkAAAAASUVORK5CYII=",
  "base64",
);
const digest = (input: string | Buffer) =>
  createHash("sha256").update(input).digest("hex");

export interface SyntheticIdDocument {
  name?: string;
  format?: "PDF" | "DOCX" | "XML";
  text?: string;
  blocks?: { text: string; path?: string }[];
  classification?: ClassificationResult;
}
export interface IdFixtureSource {
  objectId: string;
  processId: string;
  runId: string;
  files: {
    fileId: string;
    artifactId: string;
    parserTaskId: string;
    sourceHash: string;
  }[];
}
export interface IdentificationRegistry extends IdentificationSnapshot {
  object_id: string;
  process_id: string;
  current_run_id: string;
  run_id: string;
  active: boolean;
  current: boolean;
  resolved_input_hash: string | null;
  allowed_actions: { apply: boolean };
  document_aliases: DocumentAlias[];
  snapshot_versions: {
    version: number;
    resolved_input_hash: string;
    created_at: string;
  }[];
  history?: { basis: string; card_version: number }[];
}

/** Real isolated PostgreSQL/RabbitMQ/storage/HTTP. Parser/model outputs are
 * explicitly synthetic so durability tests do not claim OCR quality. */
export async function createIdentificationFixture() {
  const dbName = "identification_" + randomUUID().replaceAll("-", "");
  const databaseUrl =
    "postgresql://postgres:ingestion-test-only@127.0.0.1:25432/" + dbName;
  const brokerUrl = "amqp://guest:guest@127.0.0.1:25672";
  const root = resolve("../.test-output/identification", dbName);
  let parserFingerprint: string | null = fixtureParserFingerprint;
  const health = createServer((_req, res) => {
    res.writeHead(parserFingerprint ? 200 : 503, {
      "content-type": "application/json",
    });
    res.end(
      JSON.stringify(
        parserFingerprint
          ? { status: "ok", pipeline_fingerprint: parserFingerprint }
          : { status: "unavailable" },
      ),
    );
  });
  await new Promise<void>((done) => health.listen(0, "127.0.0.1", done));
  const address = health.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test parser address");
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
    PARSER_URL: `http://127.0.0.1:${address.port}`,
    PARSER_TOKEN: "p".repeat(32),
    REDIS_URL: "redis://127.0.0.1:1",
    RABBITMQ_URL: brokerUrl,
    CLASSIFICATION_LLM_ENABLED: "false",
  });
  execFileSync(
    process.execPath,
    [resolve("../node_modules/prisma/build/index.js"), "migrate", "deploy"],
    { cwd: process.cwd(), env: process.env, stdio: "pipe" },
  );
  const { AppModule } = await import("../../src/app.module.js");
  const app: INestApplication = await NestFactory.create(AppModule, {
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
  const server = app.getHttpServer() as Server;
  const prisma = app.get(PrismaService);
  const storage = app.get(PrivateStorageService);
  const artifacts = app.get(ArtifactStorageService);
  const jobs = app.get(IdentificationJobsService);

  async function account(role: "INSPECTOR" | "ADMINISTRATOR") {
    const session = await app.get(AuthService).register({
      login: "id-" + randomUUID().slice(0, 8),
      password: "Synthetic-password-123!",
      lastName: "Тестов",
      firstName: "Инспектор",
    });
    await prisma.user.update({
      where: { id: session.user.id },
      data: { role },
    });
    return { id: session.user.id, token: session.accessToken };
  }
  const inspector = await account("INSPECTOR");
  const outsider = await account("INSPECTOR");
  const admin = await account("ADMINISTRATOR");

  async function parseFile(
    source: Pick<IdFixtureSource, "objectId" | "processId" | "runId">,
    fileId: string,
    spec: SyntheticIdDocument,
    cycle = 1,
  ) {
    const file = await prisma.file.findUniqueOrThrow({ where: { id: fileId } });
    const text = spec.text ?? "Синтетический акт № 52";
    const task = await prisma.parsingTask.create({
      data: {
        objectId: source.objectId,
        processId: source.processId,
        runId: source.runId,
        fileId,
        cycle,
        state: "succeeded",
        attempts: 1,
        pipelineFingerprint: fixtureParserFingerprint,
        pagesCompleted: 1,
        pagesTotal: 1,
        completedAt: new Date(),
      },
    });
    const imageKey = randomUUID();
    await writeFile(resolve(root, "derived", imageKey), png);
    const artifact: ParseArtifactData = {
      schema_version: 1,
      source_sha256: file.sha256,
      pipeline_fingerprint: fixtureParserFingerprint,
      versions: { parser: "synthetic-identification-v1" },
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
            font_sha256: fixtureParserFingerprint,
            layout: "synthetic",
            render_width: 1,
            render_height: 1,
          },
          blocks: (spec.blocks ?? [{ text }]).map((block, i) => ({
            id: `p1:b${i}`,
            order: i,
            kind: "text",
            raw_text: block.text,
            normalized_text: block.text,
            bbox: [0, 0, 1, 1],
            confidence: null,
            source: "structured",
            structural_path: block.path ?? `/synthetic/block/${i}`,
            table_id: null,
            row: null,
            column: null,
            row_span: null,
            column_span: null,
          })),
        },
      ],
    };
    const stored = await prisma.parseArtifact.create({
      data: {
        taskId: task.id,
        sourceSha256: file.sha256,
        pipelineFingerprint: fixtureParserFingerprint,
        ...(await artifacts.write(artifact)),
        quality: "OK",
        reasons: [],
        pagesTotal: 1,
      },
    });
    const classification: ClassificationResult = spec.classification ?? {
      schema_version: 1,
      stage: "ID",
      document_kind: "Акт освидетельствования скрытых работ",
      kind_code: "AOSR",
      method: "rules",
      needs_review: false,
      reasons: [],
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
    await prisma.classificationTask.create({
      data: {
        artifactId: stored.id,
        fingerprint: fixtureParserFingerprint,
        state: "succeeded",
        result: identificationJson(classification),
        completedAt: new Date(),
      },
    });
    return {
      fileId,
      artifactId: stored.id,
      parserTaskId: task.id,
      sourceHash: file.sha256,
    };
  }

  async function seed(
    documents: SyntheticIdDocument[] = [{}],
  ): Promise<IdFixtureSource> {
    const object = await prisma.constructionObject.create({
      data: {
        name: "Синтетический объект идентификации",
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
    const pending = documents.map((spec) => {
      const fileId = randomUUID();
      const content = Buffer.from(`<synthetic id="${fileId}"/>`);
      return { spec, fileId, content, hash: digest(content) };
    });
    const manifest = {
      schema_version: 1,
      object_id: object.id,
      process_id: process.id,
      run_id: runId,
      files: pending
        .map((item) => ({ file_id: item.fileId, file_hash: item.hash }))
        .sort((a, b) => a.file_id.localeCompare(b.file_id)),
      versions: {},
    };
    await prisma.run.create({
      data: {
        id: runId,
        processId: process.id,
        objectId: object.id,
        version: 1,
        inputManifest: manifest,
        inputManifestHash: digest(canonicalJson(manifest)),
      },
    });
    const source = { objectId: object.id, processId: process.id, runId };
    const files: IdFixtureSource["files"] = [];
    for (const item of pending) {
      const temporary = await storage.temporary();
      await temporary.handle.writeFile(item.content);
      await temporary.handle.close();
      const storageKey = await storage.publish(temporary.key);
      await storage.discard(temporary.key);
      await prisma.file.create({
        data: {
          id: item.fileId,
          ...source,
          originalName: item.spec.name ?? "synthetic.xml",
          format: item.spec.format ?? "XML",
          size: item.content.length,
          sha256: item.hash,
          storageKey,
          uploadedBy: inspector.id,
        },
      });
      await prisma.runInput.create({
        data: { ...source, fileId: item.fileId },
      });
      files.push(await parseFile(source, item.fileId, item.spec));
    }
    return { ...source, files };
  }

  async function identify(source: Pick<IdFixtureSource, "runId">) {
    await jobs.recover();
    for (const task of await prisma.identificationTask.findMany({
      where: { runId: source.runId, state: "queued" },
    }))
      await jobs.execute(task.id);
  }
  async function registry(
    source: Pick<IdFixtureSource, "processId">,
    runId?: string,
    resolvedInputHash?: string,
  ) {
    const response = await request(server)
      .get(
        `/api/v1/processes/${source.processId}/documents${runId ? `?run_id=${runId}` : ""}`,
      )
      .query(
        resolvedInputHash ? { resolved_input_hash: resolvedInputHash } : {},
      )
      .auth(inspector.token, { type: "bearer" });
    if (response.status !== 200)
      throw new Error(
        `Registry HTTP ${response.status}: ${JSON.stringify(response.body)}`,
      );
    return response.body as IdentificationRegistry;
  }
  function apply(
    source: Pick<IdFixtureSource, "processId">,
    body: ClarificationBatch,
    user = inspector,
  ) {
    return request(server)
      .post(`/api/v1/processes/${source.processId}/document-resolutions`)
      .auth(user.token, { type: "bearer" })
      .send(body);
  }
  async function close() {
    await app.close();
    await new Promise<void>((done) => health.close(() => done()));
    await writeFile(resolve(root, "database.txt"), dbName);
  }
  return {
    app,
    prisma,
    server,
    inspector,
    outsider,
    admin,
    seed,
    parseFile,
    identify,
    registry,
    apply,
    jobs,
    artifacts,
    parserFingerprint: fixtureParserFingerprint,
    setParserFingerprint: (value: string | null) => {
      parserFingerprint = value;
    },
    brokerUrl,
    databaseUrl,
    close,
  };
}
export type IdentificationFixture = Awaited<
  ReturnType<typeof createIdentificationFixture>
>;
