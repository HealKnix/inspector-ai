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
import {
  regressionEngines,
  reviewHash,
  reviewedRuleHash,
} from "./matrix-review-contract.js";
import {
  lockMatrixParameter,
  requireRuleRegression,
} from "./matrix-review.service.js";
import {
  lockReleaseSelection,
  matrixCodes,
  releaseCatalog,
  releaseEntry,
  releaseFingerprint,
  releaseRules,
  validateRelease,
  type ReleaseManifest,
} from "./rule-set-release.js";

type Actor = { userId: string; requestId: string; ip?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
@Injectable()
export class RuleSetReleaseService {
  constructor(private readonly prisma: PrismaService) {}
  async list() {
    return this.prisma.$transaction(
      async (tx) => ({
        schema_version: 1,
        active_release_id:
          (await tx.ruleSetSelection.findUnique({ where: { id: 1 } }))
            ?.releaseId ?? null,
        releases: await tx.ruleSetRelease.findMany({
          orderBy: { createdAt: "desc" },
          take: 100,
        }),
      }),
      { isolationLevel: "RepeatableRead" },
    );
  }
  async get(id: string) {
    if (!uuid.test(id)) throw new BadRequestException("Требуется UUID выпуска");
    const release = await this.prisma.ruleSetRelease.findUnique({
      where: { id },
    });
    if (!release) throw new NotFoundException("Выпуск не найден");
    return { schema_version: 1, release };
  }
  async build(actor: Actor, input: unknown) {
    if (
      !record(input) ||
      !["partial", "full"].includes(String(input.mode)) ||
      !Array.isArray(input.rule_ids) ||
      !input.rule_ids.length ||
      input.rule_ids.length > 132 ||
      input.rule_ids.some((id) => typeof id !== "string" || !uuid.test(id)) ||
      Object.keys(input).some((key) => !["mode", "rule_ids"].includes(key))
    )
      throw new BadRequestException(
        "Ожидается mode partial/full и rule_ids (1–132 UUID)",
      );
    const ids = input.rule_ids as string[];
    if (new Set(ids).size !== ids.length)
      throw new BadRequestException("Повтор версии правила");
    return this.prisma.$transaction(
      async (tx) => {
        await lockReleaseSelection(tx);
        const rules = await tx.ruleVersion.findMany({
          where: { id: { in: ids } },
          orderBy: { parameterCode: "asc" },
        });
        if (rules.length !== ids.length)
          throw new NotFoundException("Версия правила не найдена");
        for (const code of [...new Set(rules.map((r) => r.parameterCode))])
          await lockMatrixParameter(tx, code);
        const entries: ReturnType<typeof releaseEntry>[] = [];
        const catalog = await releaseCatalog(tx);
        for (const initial of rules) {
          const rule = await tx.ruleVersion.findUniqueOrThrow({
            where: { id: initial.id },
          });
          if (rule.status !== "approved")
            throw new UnprocessableEntityException(
              `${rule.parameterCode}: версия не утверждена`,
            );
          const gate = await requireRuleRegression(tx, rule);
          const passport = await tx.rulePassport.findUniqueOrThrow({
            where: { id: gate.passport_id },
            include: { matrixRow: true },
          });
          if (passport.matrixRow.importId !== catalog?.import_id)
            throw new UnprocessableEntityException(
              `${rule.parameterCode}: паспорт другого каталога`,
            );
          entries.push({ ...releaseEntry(rule), ...gate });
        }
        const manifest: ReleaseManifest = {
          schema_version: 1,
          mode: input.mode as "partial" | "full",
          catalog,
          engines: regressionEngines,
          extraction_fingerprint: releaseFingerprint(entries),
          entries,
          omitted_parameter_codes: matrixCodes.filter(
            (c) => !entries.some((e) => e.parameter_code === c),
          ),
        };
        validateRelease(manifest);
        const manifestHash = reviewHash(manifest);
        const existing = await tx.ruleSetRelease.findUnique({
          where: { manifestHash },
        });
        if (existing)
          return { schema_version: 1, release: existing, reused: true };
        const release = await tx.ruleSetRelease.create({
          data: {
            manifest: manifest as unknown as Prisma.InputJsonValue,
            manifestHash,
            createdBy: actor.userId,
          },
        });
        await writeAuditEvent(tx, {
          data: {
            ...actor,
            action: "matrix.release.built",
            details: {
              release_id: release.id,
              manifest_hash: manifestHash,
              mode: manifest.mode,
              count: entries.length,
            },
          },
        });
        return { schema_version: 1, release, reused: false };
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  }
  async publish(actor: Actor, id: string, input: unknown) {
    if (
      !uuid.test(id) ||
      !record(input) ||
      !(
        input.expected_active_release_id === null ||
        (typeof input.expected_active_release_id === "string" &&
          uuid.test(input.expected_active_release_id))
      ) ||
      Object.keys(input).some((k) => k !== "expected_active_release_id")
    )
      throw new BadRequestException(
        "Требуется expected_active_release_id (UUID или null)",
      );
    return this.prisma.$transaction(
      async (tx) => {
        await lockReleaseSelection(tx);
        const selected = await tx.ruleSetSelection.findUniqueOrThrow({
          where: { id: 1 },
        });
        if (selected.releaseId !== input.expected_active_release_id)
          throw new ConflictException(
            "Активный выпуск изменился. Обновите список перед публикацией",
          );
        const release = await tx.ruleSetRelease.findUnique({ where: { id } });
        if (!release) throw new NotFoundException("Выпуск не найден");
        const manifest = release.manifest as unknown as ReleaseManifest;
        releaseRules(manifest, release.manifestHash);
        if (manifest.mode === "legacy_capture")
          throw new UnprocessableEntityException(
            "Исторический снимок не является допущенным выпуском",
          );
        const catalog = await releaseCatalog(tx);
        if (reviewHash(catalog) !== reviewHash(manifest.catalog))
          throw new ConflictException("Выпуск относится к другому каталогу");
        for (const entry of manifest.entries) {
          await lockMatrixParameter(tx, entry.parameter_code);
          const rule = await tx.ruleVersion.findUniqueOrThrow({
            where: { id: entry.rule_version_id },
          });
          // Deprecated versions remain eligible for an explicit compatible rollback.
          if (
            !["approved", "deprecated"].includes(rule.status) ||
            reviewedRuleHash(rule, entry.passport_hash!) !== entry.rule_hash
          )
            throw new ConflictException(
              `${entry.parameter_code}: содержание или допуск изменились`,
            );
          const gate = await requireRuleRegression(tx, rule);
          if (
            gate.regression_report_id !== entry.regression_report_id ||
            gate.passport_id !== entry.passport_id
          )
            throw new ConflictException(
              `${entry.parameter_code}: основания регрессии изменились`,
            );
        }
        await tx.ruleSetSelection.update({
          where: { id: 1 },
          data: { releaseId: id, updatedAt: new Date() },
        });
        await writeAuditEvent(tx, {
          data: {
            ...actor,
            action: "matrix.release.published",
            details: {
              release_id: id,
              previous_release_id: selected.releaseId,
              manifest_hash: release.manifestHash,
            },
          },
        });
        return {
          schema_version: 1,
          active_release_id: id,
          previous_release_id: selected.releaseId,
        };
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  }
}
