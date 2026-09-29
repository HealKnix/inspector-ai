import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client.js";
import { writeAuditEvent } from "../../infrastructure/audit/audit-envelope.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { record } from "../parsing/parsing-contract.js";
import { runRuleRegression } from "./matrix-regression.js";
import {
  regressionEngines,
  reviewedRuleHash,
  reviewHash,
  validatePassportContent,
  validatePassportInput,
  validateRegressionInput,
  type RulePassportContent,
} from "./matrix-review-contract.js";

type Actor = { userId: string; requestId: string; ip?: string };
function json(value: unknown): Prisma.InputJsonValue {
  // All callers have passed the runtime contract, or constructed JSON values.
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
export async function lockMatrixParameter(
  tx: Prisma.TransactionClient,
  code: string,
) {
  await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtext(${code}))`;
}

@Injectable()
export class MatrixReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async history(ruleId: string) {
    const rule = await this.prisma.ruleVersion.findUnique({
      where: { id: ruleId },
    });
    if (!rule) throw new NotFoundException("Версия правила не найдена");
    const [passports, reports] = await Promise.all([
      this.prisma.rulePassport.findMany({
        where: { ruleVersionId: ruleId },
        orderBy: { revision: "desc" },
      }),
      this.prisma.ruleRegressionReport.findMany({
        where: { ruleVersionId: ruleId },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);
    let approval = {
      eligible: false,
      reason: "Утверждается только черновик" as string | null,
    };
    if (rule.status === "draft") {
      try {
        await this.prisma.$transaction(
          (tx) => requireRuleRegression(tx, rule),
          {
            isolationLevel: "RepeatableRead",
          },
        );
        approval = { eligible: true, reason: null };
      } catch (error) {
        if (!(error instanceof UnprocessableEntityException)) throw error;
        approval.reason = error.message;
      }
    }
    return {
      schema_version: 1,
      rule_id: ruleId,
      passports,
      reports,
      legacy_without_review: passports.length === 0,
      approval,
    };
  }

  async savePassport(actor: Actor, ruleId: string, input: unknown) {
    let parsed;
    try {
      parsed = validatePassportInput(input);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "Некорректный паспорт",
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.ruleVersion.findUnique({
        where: { id: ruleId },
      });
      if (!initial) throw new NotFoundException("Версия правила не найдена");
      await lockMatrixParameter(tx, initial.parameterCode);
      const rule = await tx.ruleVersion.findUniqueOrThrow({
        where: { id: ruleId },
      });
      if (rule.status !== "draft")
        throw new ConflictException(
          "Паспорт изменяется только новой редакцией черновика",
        );
      const row = await tx.matrixRow.findUnique({
        where: { id: parsed.matrix_row_id },
        include: { import: true },
      });
      if (
        !row ||
        row.parameterCode !== rule.parameterCode ||
        row.parameterId !== rule.parameterId
      )
        throw new BadRequestException(
          "Строка Матрицы не соответствует правилу",
        );
      const content: RulePassportContent = {
        ...parsed,
        source: {
          import_id: row.importId,
          catalog_sha256: row.import.sourceSha256,
          origin_sha256: row.import.originSha256,
          row_sha256: reviewHash(row.raw),
          parameter_code: row.parameterCode,
          trigger: row.triggerText,
        },
      };
      const contentHash = reviewHash(content);
      const existing = await tx.rulePassport.findUnique({
        where: {
          ruleVersionId_contentHash: { ruleVersionId: ruleId, contentHash },
        },
      });
      if (existing)
        return { schema_version: 1, passport: existing, reused: true };
      const last = await tx.rulePassport.findFirst({
        where: { ruleVersionId: ruleId },
        orderBy: { revision: "desc" },
      });
      const passport = await tx.rulePassport.create({
        data: {
          ruleVersionId: ruleId,
          matrixRowId: row.id,
          revision: (last?.revision ?? 0) + 1,
          content: json(content),
          contentHash,
          createdBy: actor.userId,
        },
      });
      await writeAuditEvent(tx, {
        data: {
          ...actor,
          action: "matrix.rule.passport_created",
          details: {
            schema_version: 1,
            rule_version_id: ruleId,
            passport_id: passport.id,
            revision: passport.revision,
            content_hash: contentHash,
          },
        },
      });
      return { schema_version: 1, passport, reused: false };
    });
  }

  async runRegression(actor: Actor, ruleId: string, input: unknown) {
    const rule = await this.prisma.ruleVersion.findUnique({
      where: { id: ruleId },
    });
    if (!rule) throw new NotFoundException("Версия правила не найдена");
    if (rule.status !== "draft")
      throw new ConflictException("Регрессии запускаются для черновика");
    const passport = await this.prisma.rulePassport.findFirst({
      where: { ruleVersionId: ruleId },
      orderBy: { revision: "desc" },
    });
    if (!passport)
      throw new UnprocessableEntityException(
        "Сначала сохраните паспорт правила",
      );
    let report;
    try {
      report = runRuleRegression(
        rule,
        validatePassportContent(passport.content),
        validateRegressionInput(input),
      );
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : "Некорректные примеры регрессии",
      );
    }
    // Execution stays outside the transaction. Recheck the version under the
    // same lock as approval/passport writes before publishing its report.
    return this.prisma.$transaction(async (tx) => {
      await lockMatrixParameter(tx, rule.parameterCode);
      const current = await tx.ruleVersion.findUniqueOrThrow({
        where: { id: ruleId },
      });
      const latest = await tx.rulePassport.findFirst({
        where: { ruleVersionId: ruleId },
        orderBy: { revision: "desc" },
      });
      if (
        current.status !== "draft" ||
        latest?.id !== passport.id ||
        reviewedRuleHash(current, passport.contentHash) !== report.rule_hash
      )
        throw new ConflictException(
          "Правило или паспорт изменились во время регрессии",
        );
      const reportHash = reviewHash(report);
      const existing = await tx.ruleRegressionReport.findUnique({
        where: {
          ruleVersionId_reportHash: { ruleVersionId: ruleId, reportHash },
        },
      });
      if (existing)
        return { schema_version: 1, report: existing, reused: true };
      const saved = await tx.ruleRegressionReport.create({
        data: {
          ruleVersionId: ruleId,
          passportId: passport.id,
          ruleHash: report.rule_hash,
          fixturesHash: report.fixtures_hash,
          engineFingerprint: report.engine_fingerprint,
          reportHash,
          report: json(report),
          createdBy: actor.userId,
        },
      });
      await writeAuditEvent(tx, {
        data: {
          ...actor,
          action: "matrix.rule.regression_recorded",
          details: {
            schema_version: 1,
            rule_version_id: ruleId,
            passport_id: passport.id,
            report_id: saved.id,
            report_hash: reportHash,
            passed: report.passed,
            corpus_accuracy: null,
          },
        },
      });
      return { schema_version: 1, report: saved, reused: false };
    });
  }
}

/** Called inside the locked approval transaction; clients cannot submit a report. */
export async function requireRuleRegression(
  tx: Prisma.TransactionClient,
  rule: Parameters<typeof reviewedRuleHash>[0],
) {
  const passport = await tx.rulePassport.findFirst({
    where: { ruleVersionId: rule.id },
    orderBy: { revision: "desc" },
    include: { matrixRow: { include: { import: true } } },
  });
  if (!passport)
    throw new UnprocessableEntityException(
      "Утверждение требует паспорта и regression-отчёта этой версии",
    );
  const content = validatePassportContent(passport.content);
  if (
    passport.contentHash !== reviewHash(content) ||
    content.source.row_sha256 !== reviewHash(passport.matrixRow.raw) ||
    content.source.trigger !== passport.matrixRow.triggerText ||
    content.source.catalog_sha256 !== passport.matrixRow.import.sourceSha256 ||
    content.source.origin_sha256 !== passport.matrixRow.import.originSha256
  )
    throw new UnprocessableEntityException(
      "Основания паспорта изменились; требуется новая регрессия",
    );
  const expectedHash = reviewedRuleHash(rule, passport.contentHash);
  const reports = await tx.ruleRegressionReport.findMany({
    where: {
      ruleVersionId: rule.id,
      passportId: passport.id,
      ruleHash: expectedHash,
      engineFingerprint: reviewHash(regressionEngines),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const report = reports.find(
    (r) =>
      record(r.report) &&
      r.report.passed === true &&
      r.reportHash === reviewHash(r.report),
  );
  if (!report)
    throw new UnprocessableEntityException(
      "Нет успешной регрессии текущего плана, оснований и исполнителей; dry-run extracted недостаточно",
    );
  return {
    passport_id: passport.id,
    passport_hash: passport.contentHash,
    regression_report_id: report.id,
    regression_report_hash: report.reportHash,
    rule_hash: expectedHash,
  };
}
