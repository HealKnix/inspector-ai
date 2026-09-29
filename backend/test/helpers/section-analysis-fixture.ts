import { ValidationPipe, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
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
import {
  SECTION_ANALYSIS_EXECUTOR,
  SectionAnalysisJobsService,
  type SectionAnalysisExecutor,
  type SectionAnalysisWork,
} from "../../src/modules/extraction/section-analysis-jobs.service.js";
import type { SectionAnalysisOutput } from "../../src/modules/extraction/section-contract.js";
import type { ClassificationResult } from "../../src/modules/identification/classification-contract.js";
import { IdentificationJobsService } from "../../src/modules/identification/identification-jobs.service.js";
import { identificationJson } from "../../src/modules/identification/identification-state.js";
import { ArtifactStorageService } from "../../src/modules/parsing/artifact-storage.service.js";
import type { ParseArtifactData } from "../../src/modules/parsing/parsing-contract.js";

export interface SectionTaskView {
  id: string;
  state: string;
  error_code: string | null;
  cycle: number;
  attempts: number;
  fingerprint: string;
  config_fingerprint: string;
  matrix_import_id: string;
  resolved_input_hash: string;
  source_fingerprint: string;
  parameter_codes: string[];
  stale: boolean;
  created_at: string;
  completed_at: string | null;
}
export interface SectionStatusBody {
  schema_version: number;
  enabled: boolean;
  process_id: string | null;
  run_id: string | null;
  resolved_input_hash: string | null;
  current: boolean;
  active: boolean;
  poll_after_ms: number;
  task: SectionTaskView | null;
  results: unknown;
}
export interface SectionAdmitBody {
  schema_version: number;
  request_id: string;
  task: SectionTaskView;
}

export const fixtureParserFingerprint = "d".repeat(64);
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j/qkAAAAASUVORK5CYII=",
  "base64",
);
const digest = (input: string | Buffer) =>
  createHash("sha256").update(input).digest("hex");

export interface SyntheticSectionDocument {
  name?: string;
  format?: "PDF" | "DOCX" | "XML";
  text?: string;
  blocks?: { text: string; path?: string }[];
  pages?: { text: string; path?: string }[][];
  classification?: ClassificationResult;
}
export interface SectionFixtureSource {
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

export const syntheticSectionOutput: SectionAnalysisOutput = {
  schema_version: 1,
  engine: "synthetic-section-engine-v1",
  analysis_basis: {
    matrix_identity: "0".repeat(64),
    model: "synthetic",
    discovery_prompt_version: "synthetic",
    analysis_prompt_version: "synthetic",
  },
  contexts: [],
  skipped_contexts: [],
  calls_used: 0,
  failures: [],
};

export interface StubSectionExecutor extends SectionAnalysisExecutor {
  enabled: boolean;
  configFingerprint: string;
  calls: SectionAnalysisWork[];
  impl: (
    work: SectionAnalysisWork,
    signal?: AbortSignal,
  ) => Promise<SectionAnalysisOutput>;
}

function createStubExecutor(): StubSectionExecutor {
  const stub: StubSectionExecutor = {
    enabled: true,
    configFingerprint: "e".repeat(64),
    calls: [],
    impl: () => Promise.resolve(syntheticSectionOutput),
    execute(work, signal) {
      stub.calls.push(work);
      return stub.impl(work, signal);
    },
  };
  return stub;
}

/** Real isolated PostgreSQL/storage/HTTP with a deterministic in-process
 * section executor; no provider is ever contacted by these tests. */
export async function createSectionFixture() {
  const dbName = "section_" + randomUUID().replaceAll("-", "");
  const databaseUrl =
    "postgresql://postgres:ingestion-test-only@127.0.0.1:25432/" + dbName;
  const brokerUrl = "amqp://guest:guest@127.0.0.1:25672";
  const root = resolve("../.test-output/section-analysis", dbName);
  const parserFingerprint: string | null = fixtureParserFingerprint;
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
    SECTION_LLM_ENABLED: "false",
  });
  execFileSync(
    process.execPath,
    [resolve("../node_modules/prisma/build/index.js"), "migrate", "deploy"],
    { cwd: process.cwd(), env: process.env, stdio: "pipe" },
  );
  const executor = createStubExecutor();
  const { AppModule } = await import("../../src/app.module.js");
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(SECTION_ANALYSIS_EXECUTOR)
    .useValue(executor)
    .compile();
  const app: INestApplication = moduleRef.createNestApplication({
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
  const identificationJobs = app.get(IdentificationJobsService);
  const sectionJobs = app.get(SectionAnalysisJobsService);

  async function account(role: "INSPECTOR" | "ADMINISTRATOR") {
    const session = await app.get(AuthService).register({
      login: "sa-" + randomUUID().slice(0, 8),
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
    source: Pick<SectionFixtureSource, "objectId" | "processId" | "runId">,
    fileId: string,
    spec: SyntheticSectionDocument,
    cycle = 1,
  ) {
    const file = await prisma.file.findUniqueOrThrow({ where: { id: fileId } });
    const text = spec.text ?? "Синтетический акт № 52";
    const pageBlocks = spec.pages ?? [spec.blocks ?? [{ text }]];
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
        pagesCompleted: pageBlocks.length,
        pagesTotal: pageBlocks.length,
        completedAt: new Date(),
      },
    });
    const imageKeys = pageBlocks.map(() => randomUUID());
    await Promise.all(
      imageKeys.map((key) => writeFile(resolve(root, "derived", key), png)),
    );
    const artifact: ParseArtifactData = {
      schema_version: 1,
      source_sha256: file.sha256,
      pipeline_fingerprint: fixtureParserFingerprint,
      versions: { parser: "synthetic-identification-v1" },
      raw_text: text,
      normalized_text: text,
      quality: "OK",
      reasons: [],
      coverage: {
        total_pages: pageBlocks.length,
        readable_pages: pageBlocks.length,
        unreadable_pages: 0,
      },
      pages: pageBlocks.map((blocks, pageIndex) => ({
        page_number: pageIndex + 1,
        sheet_label: null,
        width: 1,
        height: 1,
        image_key: imageKeys[pageIndex]!,
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
        blocks: blocks.map((block, i) => ({
          id: `p${pageIndex + 1}:b${i}`,
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
      })),
    };
    const stored = await prisma.parseArtifact.create({
      data: {
        taskId: task.id,
        sourceSha256: file.sha256,
        pipelineFingerprint: fixtureParserFingerprint,
        ...(await artifacts.write(artifact)),
        quality: "OK",
        reasons: [],
        pagesTotal: pageBlocks.length,
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
    documents: SyntheticSectionDocument[] = [{}],
    ruleSetReleaseId?: string,
  ): Promise<SectionFixtureSource> {
    const object = await prisma.constructionObject.create({
      data: {
        name: "Синтетический объект секционного анализа",
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
    // Runs are immutable once inserted: the release pin is set at creation.
    await prisma.run.create({
      data: {
        id: runId,
        processId: process.id,
        objectId: object.id,
        version: 1,
        inputManifest: manifest,
        inputManifestHash: digest(canonicalJson(manifest)),
        ruleSetReleaseId: ruleSetReleaseId ?? null,
      },
    });
    const source = { objectId: object.id, processId: process.id, runId };
    const files: SectionFixtureSource["files"] = [];
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

  /** Runs the real identification pipeline so a resolved-input snapshot and
   * a ready source fingerprint exist for admission. */
  async function identify(source: Pick<SectionFixtureSource, "runId">) {
    await identificationJobs.recover();
    for (const task of await prisma.identificationTask.findMany({
      where: { runId: source.runId, state: "queued" },
    }))
      await identificationJobs.execute(task.id);
  }

  /** A synthetic matrix import with one row per code, latest by importedAt. */
  async function seedMatrix(codes: string[] = ["P001", "P002"]) {
    const imported = await prisma.matrixImport.create({
      data: {
        sourceName: "synthetic-sections",
        sourceSha256: digest(`matrix:${codes.join(",")}:${randomUUID()}`),
        originSha256: digest("synthetic-origin"),
        rowCount: codes.length,
      },
    });
    for (const [index, code] of codes.entries())
      await prisma.matrixRow.create({
        data: {
          importId: imported.id,
          parameterId: index + 1,
          parameterCode: code,
          pdSection: "ПЗ",
          name: `Синтетический параметр ${code}`,
          unit: "m2",
          triggerText: "Синтетический триггер; не реальная норма",
          matrixRow: index + 1,
          raw: { synthetic: true, parameter_code: code },
        },
      });
    return imported;
  }

  async function postSection(
    objectId: string,
    body: unknown,
    user = inspector,
  ) {
    const response = await request(server)
      .post(`/api/v1/objects/${objectId}/section-analysis`)
      .auth(user.token, { type: "bearer" })
      .send(body as object);
    return {
      status: response.status,
      body: response.body as SectionAdmitBody,
    };
  }
  async function getSection(
    objectId: string,
    runId?: string,
    user = inspector,
  ) {
    const response = await request(server)
      .get(
        `/api/v1/objects/${objectId}/section-analysis${runId ? `?run_id=${runId}` : ""}`,
      )
      .auth(user.token, { type: "bearer" });
    return {
      status: response.status,
      body: response.body as SectionStatusBody,
    };
  }
  function resetExecutor() {
    executor.enabled = true;
    executor.configFingerprint = "e".repeat(64);
    executor.calls = [];
    executor.impl = () => Promise.resolve(syntheticSectionOutput);
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
    seedMatrix,
    postSection,
    getSection,
    executor,
    resetExecutor,
    sectionJobs,
    artifacts,
    brokerUrl,
    databaseUrl,
    close,
  };
}
export type SectionFixture = Awaited<ReturnType<typeof createSectionFixture>>;
