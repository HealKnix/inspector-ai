import {
  ConflictException,
  UnprocessableEntityException,
} from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client.js";
import { validateComparisonSpec } from "./comparison-contract.js";
import { validateExtractionPlan } from "./extraction-contract.js";
import { rulesetFingerprint, type ApprovedRule } from "./extraction-engine.js";
import {
  regressionEngines,
  reviewHash,
  type ReviewRule,
} from "./matrix-review-contract.js";

export type ReleaseEntry = {
  parameter_code: string;
  rule_version_id: string;
  version: number;
  plan: unknown;
  comparison: unknown;
  applicability: unknown;
  passport_id: string | null;
  passport_hash: string | null;
  regression_report_id: string | null;
  regression_report_hash: string | null;
  rule_hash: string | null;
};
export interface ReleaseManifest {
  schema_version: 1;
  mode: "partial" | "full" | "legacy_capture";
  catalog: {
    import_id: string;
    catalog_sha256: string;
    origin_sha256: string | null;
    row_count: number;
  } | null;
  engines: typeof regressionEngines;
  extraction_fingerprint: string;
  entries: ReleaseEntry[];
  omitted_parameter_codes: string[];
}
export const matrixCodes = Array.from(
  { length: 132 },
  (_, i) => `P${String(i + 1).padStart(3, "0")}`,
);
export function releaseFingerprint(entries: ReleaseEntry[]): string {
  return rulesetFingerprint(
    entries.map((e) => ({
      parameter_code: e.parameter_code,
      rule_version_id: e.rule_version_id,
      version: e.version,
      plan: validateExtractionPlan(e.plan),
      comparison:
        e.comparison === null ? null : validateComparisonSpec(e.comparison),
    })),
  );
}
export function releaseEntry(rule: ReviewRule): ReleaseEntry {
  return {
    parameter_code: rule.parameterCode,
    rule_version_id: rule.id,
    version: rule.version,
    plan: rule.plan,
    comparison: rule.comparison,
    applicability: rule.applicability,
    passport_id: null,
    passport_hash: null,
    regression_report_id: null,
    regression_report_hash: null,
    rule_hash: null,
  };
}
export function validateRelease(manifest: ReleaseManifest) {
  const codes = manifest.entries.map((e) => e.parameter_code);
  if (
    new Set(codes).size !== codes.length ||
    (manifest.mode !== "legacy_capture" &&
      codes.some((c) => !matrixCodes.includes(c)))
  )
    throw new UnprocessableEntityException(
      "Состав выпуска содержит повторный или неизвестный параметр",
    );
  const omitted = matrixCodes.filter((c) => !codes.includes(c));
  if (reviewHash(omitted) !== reviewHash(manifest.omitted_parameter_codes))
    throw new UnprocessableEntityException(
      "Покрытие выпуска не соответствует составу",
    );
  if (manifest.mode !== "legacy_capture") {
    if (
      !codes.length ||
      !manifest.catalog ||
      manifest.catalog.row_count !== 132
    )
      throw new UnprocessableEntityException(
        "Требуются проверенные правила и каталог из 132 строк",
      );
    if (manifest.mode === "full" && omitted.length)
      throw new UnprocessableEntityException(
        "Полный выпуск требует ровно 132 принятых параметра",
      );
    if (
      manifest.entries.some(
        (e) => !e.passport_hash || !e.regression_report_hash || !e.rule_hash,
      )
    )
      throw new UnprocessableEntityException(
        "В составе отсутствуют паспорта или отчёты",
      );
  }
  if (reviewHash(manifest.engines) !== reviewHash(regressionEngines))
    throw new ConflictException(
      "Выпуск несовместим с текущими исполнителями; требуется новая регрессия",
    );
  for (const entry of manifest.entries) {
    validateExtractionPlan(entry.plan);
    if (entry.comparison !== null) validateComparisonSpec(entry.comparison);
  }
  if (manifest.extraction_fingerprint !== releaseFingerprint(manifest.entries))
    throw new ConflictException(
      "Отпечаток исполнителей не соответствует выпуску",
    );
}
export function releaseRules(
  manifest: ReleaseManifest,
  hash: string,
): ApprovedRule[] {
  if (reviewHash(manifest) !== hash)
    throw new ConflictException("Нарушена целостность выпуска");
  validateRelease(manifest);
  return manifest.entries.map((e) => ({
    parameter_code: e.parameter_code,
    rule_version_id: e.rule_version_id,
    version: e.version,
    plan: validateExtractionPlan(e.plan),
    comparison:
      e.comparison === null ? null : validateComparisonSpec(e.comparison),
  }));
}
export async function lockReleaseSelection(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT id FROM rule_set_selection WHERE id = 1 FOR UPDATE`;
}
export async function releaseCatalog(
  tx: Prisma.TransactionClient,
  strict = true,
) {
  const source = await tx.matrixImport.findFirst({
    orderBy: { importedAt: "desc" },
  });
  if (!source) return null;
  const rows = await tx.matrixRow.findMany({
    where: { importId: source.id },
    select: { parameterCode: true },
  });
  if (
    strict &&
    (rows.length !== 132 ||
      matrixCodes.some((c) => !rows.some((r) => r.parameterCode === c)))
  )
    throw new UnprocessableEntityException(
      "Каталог не содержит ровно P001–P132",
    );
  return {
    import_id: source.id,
    catalog_sha256: source.sourceSha256,
    origin_sha256: source.originSha256,
    row_count: rows.length,
  };
}
/** Called inside admission, before constructing the immutable Run manifest.
 * No active reviewed release: freeze the legacy configuration and label it as
 * unreviewed. Approval never changes an existing Run's executable snapshot. */
export async function pinRunRelease(
  tx: Prisma.TransactionClient,
  actor: string,
) {
  await lockReleaseSelection(tx);
  const selected = await tx.ruleSetSelection.findUniqueOrThrow({
    where: { id: 1 },
  });
  if (selected.releaseId) {
    const release = await tx.ruleSetRelease.findUniqueOrThrow({
      where: { id: selected.releaseId },
    });
    releaseRules(
      release.manifest as unknown as ReleaseManifest,
      release.manifestHash,
    );
    return release;
  }
  const versions = await tx.ruleVersion.findMany({
    where: { status: "approved" },
    orderBy: [{ parameterCode: "asc" }, { version: "desc" }],
  });
  const seen = new Set<string>();
  const entries: ReleaseEntry[] = [];
  for (const rule of versions) {
    if (seen.has(rule.parameterCode)) continue;
    seen.add(rule.parameterCode);
    try {
      validateExtractionPlan(rule.plan);
      if (rule.comparison !== null) validateComparisonSpec(rule.comparison);
      entries.push(releaseEntry(rule));
    } catch {
      /* Legacy invalid plans were never executable. */
    }
  }
  const manifest: ReleaseManifest = {
    schema_version: 1,
    mode: "legacy_capture",
    catalog: await releaseCatalog(tx, false),
    engines: regressionEngines,
    extraction_fingerprint: releaseFingerprint(entries),
    entries,
    omitted_parameter_codes: matrixCodes.filter(
      (c) => !entries.some((e) => e.parameter_code === c),
    ),
  };
  const manifestHash = reviewHash(manifest);
  return tx.ruleSetRelease.upsert({
    where: { manifestHash },
    update: {},
    create: {
      manifest: manifest as unknown as Prisma.InputJsonValue,
      manifestHash,
      createdBy: actor,
    },
  });
}
