import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";
import pg from "pg";
import "reflect-metadata";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RolesGuard } from "../src/common/guards/roles.guard.js";
import { PrismaService } from "../src/infrastructure/prisma/prisma.service.js";
import { ExtractionJobsService } from "../src/modules/extraction/extraction-jobs.service.js";
import { MatrixAdminController } from "../src/modules/extraction/matrix-admin.controller.js";
import { MatrixAdminService } from "../src/modules/extraction/matrix-admin.service.js";
import type { runRuleRegression } from "../src/modules/extraction/matrix-regression.js";
import { reviewHash } from "../src/modules/extraction/matrix-review-contract.js";
import { MatrixReviewService } from "../src/modules/extraction/matrix-review.service.js";
import { RuleSetReleaseController } from "../src/modules/extraction/rule-set-release.controller.js";
import {
  matrixCodes,
  pinRunRelease,
  releaseRules,
  validateRelease,
  type ReleaseManifest,
} from "../src/modules/extraction/rule-set-release.js";
import { RuleSetReleaseService } from "../src/modules/extraction/rule-set-release.service.js";
import { ObjectAccessService } from "../src/modules/objects/object-access.service.js";
import { ArtifactStorageService } from "../src/modules/parsing/artifact-storage.service.js";
import { record } from "../src/modules/parsing/parsing-contract.js";
import { syntheticCompositeReview } from "./helpers/composite-review-fixture.js";
import {
  syntheticPassportInput,
  syntheticRegressionFixtures,
  syntheticReviewRule,
} from "./helpers/matrix-review-fixture.js";

const dbName = "matrix_review_" + randomUUID().replaceAll("-", "");
const managementUrl =
  "postgresql://postgres:ingestion-test-only@127.0.0.1:25432/ingestion_test";
const databaseUrl =
  "postgresql://postgres:ingestion-test-only@127.0.0.1:25432/" + dbName;
const migrationName = "20260927010000_matrix_review_gate";
let app: INestApplication;
let server: Server;
let prisma: PrismaService;
let admin: MatrixAdminService;
let review: MatrixReviewService;
let actor: { userId: string; requestId: string };
let rowId: string;
let legacyId: string;
let legacyHash: string;
let rawHash: string;

beforeAll(async () => {
  const management = new pg.Client({ connectionString: managementUrl });
  await management.connect();
  await management.query(`CREATE DATABASE "${dbName}"`);
  await management.end();
  const database = new pg.Client({ connectionString: databaseUrl });
  await database.connect();
  const migrations = resolve("prisma/migrations");
  // Build the pre-change schema, insert historical records, then apply the
  // actual additive migration. The shared integration database is untouched.
  for (const name of readdirSync(migrations)
    .filter((n) => /^\d+_/.test(n) && n < migrationName)
    .sort()) {
    await database.query(
      readFileSync(resolve(migrations, name, "migration.sql"), "utf8"),
    );
  }
  const config = new ConfigService({
    DATABASE_URL: databaseUrl,
    CLASSIFICATION_LLM_ENABLED: false,
  });
  prisma = new PrismaService(config);
  await prisma.$connect();
  const user = await prisma.user.create({
    data: {
      login: "synthetic-matrix-admin",
      passwordHash: "unused-test-hash",
      lastName: "Тест",
      firstName: "Матрица",
      role: "ADMINISTRATOR",
    },
  });
  actor = { userId: user.id, requestId: randomUUID() };
  const imported = await prisma.matrixImport.create({
    data: {
      sourceName: "synthetic-only",
      sourceSha256: "a".repeat(64),
      originSha256: "b".repeat(64),
      rowCount: 1,
    },
  });
  const raw = {
    parameter_code: "P002",
    trigger: "Синтетический триггер; не реальная норма",
  };
  const row = await prisma.matrixRow.create({
    data: {
      importId: imported.id,
      parameterId: 2,
      parameterCode: "P002",
      pdSection: "ПЗ",
      name: "Синтетический размер",
      unit: "m2",
      triggerText: raw.trigger,
      matrixRow: 3,
      raw,
    },
  });
  rowId = row.id;
  rawHash = reviewHash(row.raw);
  const legacy = await prisma.ruleVersion.create({
    data: {
      parameterCode: "P002",
      parameterId: 2,
      version: 1,
      status: "approved",
      plan: { kind: "regex", anchors: ["старый"], pattern: "(\\d+)" },
      approvedBy: user.id,
      approvedAt: new Date("2026-09-20T00:00:00.000Z"),
    },
  });
  legacyId = legacy.id;
  legacyHash = reviewHash(JSON.parse(JSON.stringify(legacy)));
  await database.query(
    readFileSync(resolve(migrations, migrationName, "migration.sql"), "utf8"),
  );
  for (const name of readdirSync(migrations)
    .filter((n) => /^\d+_/.test(n) && n > migrationName)
    .sort())
    await database.query(
      readFileSync(resolve(migrations, name, "migration.sql"), "utf8"),
    );
  await database.end();
  const module = await Test.createTestingModule({
    controllers: [MatrixAdminController, RuleSetReleaseController],
    providers: [
      MatrixAdminService,
      MatrixReviewService,
      RuleSetReleaseService,
      ExtractionJobsService,
      ObjectAccessService,
      { provide: ConfigService, useValue: config },
      { provide: PrismaService, useValue: prisma },
      {
        provide: ArtifactStorageService,
        useValue: {
          read: () => {
            throw new Error("This suite must not read real documents");
          },
        },
      },
    ],
  }).compile();
  app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix("api");
  // Supply an already authenticated context, exercising the real RolesGuard.
  // JWT/session cryptography remains covered by the existing auth suite.
  app.use(
    (
      req: Request & { user?: { id: string; role: string } },
      _res: Response,
      next: NextFunction,
    ) => {
      req.user = {
        id: user.id,
        role:
          req.headers["x-test-role"] === "INSPECTOR"
            ? "INSPECTOR"
            : "ADMINISTRATOR",
      };
      next();
    },
  );
  app.useGlobalGuards(new RolesGuard(new Reflector()));
  await app.init();
  const instance: unknown = app.getHttpServer();
  if (!instance || typeof instance !== "object" || !("listen" in instance))
    throw new Error("HTTP server missing");
  server = instance as Server;
  admin = app.get(MatrixAdminService);
  review = app.get(MatrixReviewService);
});

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
  // Only the random database created by this suite is eligible for cleanup.
  if (!/^matrix_review_[a-f0-9]{32}$/.test(dbName))
    throw new Error("Unsafe test database name");
  const management = new pg.Client({ connectionString: managementUrl });
  await management.connect();
  await management.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await management.end();
});

async function draft() {
  return (
    await admin.createDraft(actor, "P002", {
      plan: syntheticReviewRule.plan,
      comparison: syntheticReviewRule.comparison,
    })
  ).rule;
}
async function passedDraft() {
  const rule = await draft();
  await review.savePassport(actor, rule.id, syntheticPassportInput(rowId));
  const result = await review.runRegression(actor, rule.id, {
    schema_version: 1,
    fixtures: syntheticRegressionFixtures(),
  });
  expect(result.report.report).toMatchObject({
    passed: true,
    quality: { corpus_accuracy: null },
  });
  return rule;
}

describe("MAT-A PostgreSQL + admin HTTP gate", () => {
  it("additive migration preserves raw rows and historical approved versions without inventing passports", async () => {
    const legacy = await prisma.ruleVersion.findUniqueOrThrow({
      where: { id: legacyId },
    });
    expect(reviewHash(JSON.parse(JSON.stringify(legacy)))).toBe(legacyHash);
    expect(
      reviewHash(
        (await prisma.matrixRow.findUniqueOrThrow({ where: { id: rowId } }))
          .raw,
      ),
    ).toBe(rawHash);
    expect(await review.history(legacyId)).toMatchObject({
      passports: [],
      reports: [],
      legacy_without_review: true,
    });
  });
  it("direct approve cannot bypass regression and an inspector cannot write a passport", async () => {
    const rule = await draft();
    await request(server)
      .post(`/api/v1/admin/matrix/rules/${rule.id}/approve`)
      .expect(422);
    await request(server)
      .post(`/api/v1/admin/matrix/rules/${rule.id}/passport`)
      .set("x-test-role", "INSPECTOR")
      .send(syntheticPassportInput(rowId))
      .expect(403);
    expect(
      (await prisma.ruleVersion.findUniqueOrThrow({ where: { id: rule.id } }))
        .status,
    ).toBe("draft");
    expect(
      (await prisma.ruleVersion.findUniqueOrThrow({ where: { id: legacyId } }))
        .status,
    ).toBe("approved");
  });
  it("passport import/replay is idempotent, versions unknown basis and leaves raw source unchanged", async () => {
    const rule = await draft();
    const input = syntheticPassportInput(rowId);
    const first = await review.savePassport(actor, rule.id, input);
    const replay = await review.savePassport(
      actor,
      rule.id,
      JSON.parse(JSON.stringify(input)),
    );
    expect(replay).toMatchObject({
      reused: true,
      passport: { id: first.passport.id },
    });
    const second = await review.savePassport(actor, rule.id, {
      ...input,
      scope: "Уточнённая синтетическая область",
    });
    expect(second.passport.revision).toBe(2);
    expect(second.passport.content).toMatchObject({
      branches: [{ basis: null }, { basis: null }],
    });
    expect(
      reviewHash(
        (await prisma.matrixRow.findUniqueOrThrow({ where: { id: rowId } }))
          .raw,
      ),
    ).toBe(rawHash);
    await expect(
      prisma.$executeRaw`UPDATE rule_passports SET content_hash = ${"c".repeat(64)} WHERE id = ${first.passport.id}::uuid`,
    ).rejects.toThrow("immutable");
  });
  it("executes submitted fixtures, rejects forged report fields, approves exact content with review audit", async () => {
    const rule = await draft();
    await request(server)
      .post(`/api/v1/admin/matrix/rules/${rule.id}/passport`)
      .send(syntheticPassportInput(rowId))
      .expect(200);
    await request(server)
      .post(`/api/v1/admin/matrix/rules/${rule.id}/regression`)
      .send({
        schema_version: 1,
        fixtures: syntheticRegressionFixtures(),
        passed: true,
      })
      .expect(400);
    await request(server)
      .post(`/api/v1/admin/matrix/rules/${rule.id}/approve`)
      .expect(422);
    const fixtures = {
      schema_version: 1,
      fixtures: syntheticRegressionFixtures(),
    };
    await request(server)
      .post(`/api/v1/admin/matrix/rules/${rule.id}/regression`)
      .send(fixtures)
      .expect(200);
    expect((await review.runRegression(actor, rule.id, fixtures)).reused).toBe(
      true,
    );
    await request(server)
      .post(`/api/v1/admin/matrix/rules/${rule.id}/approve`)
      .expect(200);
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { action: "matrix.rule.approved" },
      orderBy: { createdAt: "desc" },
    });
    if (!record(audit.details)) throw new Error("Audit details missing");
    expect(audit.details.rule_version_id).toBe(rule.id);
    expect(audit.details.regression_report_id).toEqual(expect.any(String));
    expect(audit.details.passport_hash).toEqual(
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    const legacy = await prisma.ruleVersion.findUniqueOrThrow({
      where: { id: legacyId },
    });
    expect(legacy).toMatchObject({
      status: "deprecated",
      approvedBy: actor.userId,
      approvedAt: new Date("2026-09-20T00:00:00.000Z"),
    });
  });
  it("plan or passport change invalidates the old report without destroying its history", async () => {
    const rule = await passedDraft();
    await prisma.ruleVersion.update({
      where: { id: rule.id },
      data: {
        plan: {
          kind: "regex",
          anchors: ["размер"],
          pattern: "размер\\s+(999)",
          unit: ["м2"],
        },
      },
    });
    await request(server)
      .post(`/api/v1/admin/matrix/rules/${rule.id}/approve`)
      .expect(422);
    const second = await passedDraft();
    await review.savePassport(actor, second.id, {
      ...syntheticPassportInput(rowId),
      rounding: "Новая явно заданная политика теста",
    });
    await request(server)
      .post(`/api/v1/admin/matrix/rules/${second.id}/approve`)
      .expect(422);
    const reports = await prisma.ruleRegressionReport.findMany({
      where: { ruleVersionId: second.id },
    });
    expect(reports).toHaveLength(1);
    await expect(
      prisma.$executeRaw`DELETE FROM rule_regression_reports WHERE id = ${reports[0]!.id}::uuid`,
    ).rejects.toThrow("immutable");
  });
  it("failed assertions and unknown required basis never enable approval", async () => {
    const rule = await draft();
    const passport = syntheticPassportInput(rowId);
    passport.branches[1]!.basis_required = true;
    await review.savePassport(actor, rule.id, passport);
    const report = await review.runRegression(actor, rule.id, {
      schema_version: 1,
      fixtures: syntheticRegressionFixtures(),
    });
    expect(report.report.report).toMatchObject({
      passed: false,
      blockers: ["comparison:unknown_basis"],
    });
    await request(server)
      .post(`/api/v1/admin/matrix/rules/${rule.id}/approve`)
      .expect(422);
  });
  it("serializes concurrent approvals and does not erase approval provenance of prior versions", async () => {
    const first = await passedDraft();
    const second = await passedDraft();
    await Promise.all([
      admin.approve(actor, first.id),
      admin.approve(actor, second.id),
    ]);
    const approved = await prisma.ruleVersion.findMany({
      where: { parameterCode: "P002", status: "approved" },
    });
    expect(approved).toHaveLength(1);
    const versions = await prisma.ruleVersion.findMany({
      where: { id: { in: [first.id, second.id] } },
    });
    expect(
      versions.every(
        (v) => v.approvedBy === actor.userId && v.approvedAt !== null,
      ),
    ).toBe(true);
  });
  it("rolls back approval and deprecation if mandatory audit cannot be saved", async () => {
    const previous = await prisma.ruleVersion.findFirstOrThrow({
      where: { parameterCode: "P002", status: "approved" },
    });
    const rule = await passedDraft();
    await expect(
      admin.approve({ userId: randomUUID(), requestId: randomUUID() }, rule.id),
    ).rejects.toThrow();
    expect(
      (
        await prisma.ruleVersion.findUniqueOrThrow({
          where: { id: previous.id },
        })
      ).status,
    ).toBe("approved");
    expect(
      (await prisma.ruleVersion.findUniqueOrThrow({ where: { id: rule.id } }))
        .status,
    ).toBe("draft");
  });
  it("reports authoritative gate eligibility for missing, passed and stale passports", async () => {
    const rule = await draft();
    expect((await review.history(rule.id)).approval.eligible).toBe(false);
    const passed = await passedDraft();
    expect((await review.history(passed.id)).approval).toEqual({
      eligible: true,
      reason: null,
    });
    await review.savePassport(actor, passed.id, {
      ...syntheticPassportInput(rowId),
      scope: "Changed synthetic scope",
    });
    expect((await review.history(passed.id)).approval.eligible).toBe(false);
  });
  it("builds immutable partial manifests, pins before execution, serializes publication and permits compatible rollback", async () => {
    const row = await prisma.matrixRow.findUniqueOrThrow({
      where: { id: rowId },
    });
    await prisma.matrixRow.createMany({
      data: matrixCodes
        .filter((c) => c !== "P002")
        .map((code) => ({
          importId: row.importId,
          parameterCode: code,
          parameterId: Number(code.slice(1)),
          pdSection: "SYNTHETIC",
          name: "Synthetic release coverage only",
          matrixRow: Number(code.slice(1)) + 1,
          triggerText: "Not a domain norm",
          raw: { synthetic: true, code },
        })),
    });
    await prisma.matrixImport.update({
      where: { id: row.importId },
      data: { rowCount: 132 },
    });
    const releases = app.get(RuleSetReleaseService);
    const legacy = await prisma.$transaction((tx) =>
      pinRunRelease(tx, actor.userId),
    );
    expect(legacy.manifest).toMatchObject({ mode: "legacy_capture" });
    await expect(
      releases.publish(actor, legacy.id, { expected_active_release_id: null }),
    ).rejects.toThrow("Исторический");
    const first = await passedDraft();
    await admin.approve(actor, first.id);
    const built = await releases.build(actor, {
      mode: "partial",
      rule_ids: [first.id],
    });
    await expect(
      releases.build(actor, { mode: "full", rule_ids: [first.id] }),
    ).rejects.toThrow("132");
    expect(
      (await releases.build(actor, { mode: "partial", rule_ids: [first.id] }))
        .reused,
    ).toBe(true);
    await expect(
      prisma.$executeRaw`UPDATE rule_set_releases SET created_by = 'changed' WHERE id = ${built.release.id}::uuid`,
    ).rejects.toThrow(/immutable/i);
    await request(server)
      .post(`/api/v1/admin/matrix/releases/${built.release.id}/publish`)
      .set("x-test-role", "INSPECTOR")
      .send({ expected_active_release_id: null })
      .expect(403);
    await releases.publish(actor, built.release.id, {
      expected_active_release_id: null,
    });
    const pinned = await prisma.$transaction((tx) =>
      pinRunRelease(tx, actor.userId),
    );
    const object = await prisma.constructionObject.create({
      data: { name: "Synthetic pinned run", createdBy: actor.userId },
    });
    const process = await prisma.process.create({
      data: { objectId: object.id },
    });
    const run = await prisma.run.create({
      data: {
        processId: process.id,
        objectId: object.id,
        version: 1,
        ruleSetReleaseId: pinned.id,
        inputManifest: { rules: pinned.manifestHash },
        inputManifestHash: reviewHash({ rules: pinned.manifestHash }),
      },
    });
    const second = await passedDraft();
    await admin.approve(actor, second.id);
    expect(
      (await prisma.$transaction((tx) => pinRunRelease(tx, actor.userId))).id,
    ).toBe(pinned.id);
    expect(
      releaseRules(
        pinned.manifest as unknown as ReleaseManifest,
        pinned.manifestHash,
      )[0]!.rule_version_id,
    ).toBe(first.id);
    const next = await releases.build(actor, {
      mode: "partial",
      rule_ids: [second.id],
    });
    const races = await Promise.allSettled([
      releases.publish(actor, next.release.id, {
        expected_active_release_id: pinned.id,
      }),
      releases.publish(actor, next.release.id, {
        expected_active_release_id: pinned.id,
      }),
    ]);
    expect(races.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (await prisma.run.findUniqueOrThrow({ where: { id: run.id } }))
        .ruleSetReleaseId,
    ).toBe(pinned.id);
    // Exercise the worker's actual loader after a newer release is published.
    // It must keep the version admitted with this Run, including when deprecated.
    const executable = await app
      .get(ExtractionJobsService)
      .approvedRules(prisma, run.id);
    expect(executable.map((rule) => rule.rule_version_id)).toEqual([first.id]);
    expect(
      (await app.get(ExtractionJobsService).approvedRules()).map(
        (rule) => rule.rule_version_id,
      ),
    ).toEqual([second.id]);
    await expect(
      prisma.run.update({
        where: { id: run.id },
        data: { ruleSetReleaseId: next.release.id },
      }),
    ).rejects.toThrow(/immutable/i);
    await releases.publish(actor, pinned.id, {
      expected_active_release_id: next.release.id,
    });
    const manifest = pinned.manifest as unknown as ReleaseManifest;
    expect(() => validateRelease({ ...manifest, mode: "full" })).toThrow("132");
    expect(() =>
      validateRelease({
        ...manifest,
        engines: { ...manifest.engines, extraction: "outdated" },
      }),
    ).toThrow("исполнителями");
    await expect(
      releases.publish(
        { userId: randomUUID(), requestId: randomUUID() },
        next.release.id,
        { expected_active_release_id: pinned.id },
      ),
    ).rejects.toThrow();
    expect((await releases.list()).active_release_id).toBe(pinned.id);
  });
});

describe("C07 scalar composite PostgreSQL + admin HTTP gate", () => {
  async function compositeDraft() {
    const data = syntheticCompositeReview(rowId);
    const created = await request(server)
      .post("/api/v1/admin/matrix/rows/P002/rules")
      .send({ plan: data.plan, comparison: data.comparison })
      .expect(201);
    const ruleId = (created.body as { rule: { id: string } }).rule.id;
    return { ...data, ruleId };
  }
  type ReportBody = {
    report: { id: string; report: ReturnType<typeof runRuleRegression> };
    reused: boolean;
  };

  it("executes and persists all branch projections through HTTP before permitting approval", async () => {
    const { ruleId, passport, fixtures } = await compositeDraft();
    await request(server)
      .post(`/api/v1/admin/matrix/rules/${ruleId}/passport`)
      .send(passport)
      .expect(200);
    await request(server)
      .post(`/api/v1/admin/matrix/rules/${ruleId}/approve`)
      .expect(422);
    const payload = { schema_version: 1, fixtures };
    const response = await request(server)
      .post(`/api/v1/admin/matrix/rules/${ruleId}/regression`)
      .send(payload)
      .expect(200);
    const body = response.body as ReportBody;
    expect(body.report.report).toMatchObject({
      passed: true,
      blockers: [],
      engines: { composite: "composite-scalar-v1" },
      quality: { curated_cases: 0, corpus_accuracy: null },
    });
    expect(
      body.report.report.cases.find((c) => c.id === "root-positive")?.actual
        .composite?.root,
    ).toMatchObject({
      result: "false",
      determining_branch_ids: ["first", "second"],
    });
    expect(
      body.report.report.cases
        .find((c) => c.id === "root-uncertain")
        ?.actual.composite?.root.children.map((c) => c.result),
    ).toEqual(["unknown", "unknown"]);
    const persisted = await prisma.ruleRegressionReport.findUniqueOrThrow({
      where: { id: body.report.id },
    });
    expect(persisted.report).toEqual(body.report.report);
    const replay = await request(server)
      .post(`/api/v1/admin/matrix/rules/${ruleId}/regression`)
      .send(payload)
      .expect(200);
    expect(replay.body as ReportBody).toMatchObject({
      reused: true,
      report: { id: body.report.id },
    });
    await request(server)
      .post(`/api/v1/admin/matrix/rules/${ruleId}/approve`)
      .expect(200);
    expect(
      (await prisma.ruleVersion.findUniqueOrThrow({ where: { id: ruleId } }))
        .status,
    ).toBe("approved");
  });

  it("rejects altered leaf or root projection even while the submitted aggregate remains match", async () => {
    for (const target of ["first", "root"]) {
      const { ruleId, passport, fixtures } = await compositeDraft();
      await request(server)
        .post(`/api/v1/admin/matrix/rules/${ruleId}/passport`)
        .send(passport)
        .expect(200);
      const altered = fixtures.find((f) => f.id === "root-negative")!;
      expect(altered.expected.verdict).toBe("match");
      expect(altered.expected.composite!.result).toBe("true");
      altered.expected.composite!.branches.find(
        (branch) => branch.id === target,
      )!.result = "false";
      const response = await request(server)
        .post(`/api/v1/admin/matrix/rules/${ruleId}/regression`)
        .send({ schema_version: 1, fixtures })
        .expect(200);
      const report = (response.body as ReportBody).report.report;
      expect(report.passed).toBe(false);
      const checked = report.cases.find((c) => c.id === altered.id)!;
      expect(checked.actual.verdict).toBe("match");
      expect(checked.actual.composite?.result).toBe("true");
      expect(checked.errors).toContain("composite_trace_assertion_failed");
      await request(server)
        .post(`/api/v1/admin/matrix/rules/${ruleId}/approve`)
        .expect(422);
      expect(
        (await prisma.ruleVersion.findUniqueOrThrow({ where: { id: ruleId } }))
          .status,
      ).toBe("draft");
    }
  });

  it("rejects unsupported presence syntax and cannot approve an invented passport operator", async () => {
    const data = syntheticCompositeReview(rowId);
    const count = await prisma.ruleVersion.count();
    await request(server)
      .post("/api/v1/admin/matrix/rows/P002/rules")
      .send({
        plan: data.plan,
        comparison: {
          kind: "composite",
          schema_version: 1,
          root: {
            id: "root",
            kind: "and",
            children: [
              {
                id: "presence",
                kind: "presence",
                element: "synthetic-element",
              },
              {
                id: "value",
                kind: "scalar",
                comparison: syntheticReviewRule.comparison,
              },
            ],
          },
        },
      })
      .expect(400);
    expect(await prisma.ruleVersion.count()).toBe(count);
    const { ruleId, passport, fixtures } = await compositeDraft();
    passport.branches.find((branch) => branch.id === "root")!.operator =
      "presence";
    await request(server)
      .post(`/api/v1/admin/matrix/rules/${ruleId}/passport`)
      .send(passport)
      .expect(200);
    const response = await request(server)
      .post(`/api/v1/admin/matrix/rules/${ruleId}/regression`)
      .send({ schema_version: 1, fixtures })
      .expect(200);
    const report = (response.body as ReportBody).report.report;
    expect(report.passed).toBe(false);
    expect(report.blockers).toEqual(
      expect.arrayContaining([
        "composite_branch_missing",
        "root:unsupported_operator_version",
      ]),
    );
    await request(server)
      .post(`/api/v1/admin/matrix/rules/${ruleId}/approve`)
      .expect(422);
    expect(
      (await prisma.ruleVersion.findUniqueOrThrow({ where: { id: ruleId } }))
        .status,
    ).toBe("draft");
  });
});
