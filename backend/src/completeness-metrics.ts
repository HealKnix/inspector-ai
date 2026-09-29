// Сводка метрик комплектности по реальным объектам в БД: последний результат
// оценки на объект, суммарное распределение исходов, причины и сценарии.
// Использование:
//   bun run completeness:metrics
import { NestFactory } from "@nestjs/core";
import "reflect-metadata";
import { AppModule } from "./app.module.js";
import { PrismaService } from "./infrastructure/prisma/prisma.service.js";

const log = (name: string, value: unknown) =>
  console.log(JSON.stringify({ metric: name, value }));

interface EvaluatedCounts {
  applicable?: number;
  fulfilled?: number;
  fulfilled_required?: number;
  missing?: number;
  unverifiable?: number;
  not_applicable?: number;
  reasons?: Record<string, number>;
}

interface EvaluatedStage {
  status?: string;
  applicable?: number;
  fulfilled?: number;
  missing?: number;
  unverifiable?: number;
}

interface EvaluatedResult {
  scenario?: string;
  counts?: EvaluatedCounts;
  stages?: Record<string, EvaluatedStage | null>;
  requirements?: { outcome?: string; reasons?: string[] }[];
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error"],
  });
  const prisma = app.get(PrismaService);
  const rows = await prisma.$queryRaw<
    {
      object_id: string;
      object_name: string;
      result_id: string;
      run_id: string;
      evaluated_at: Date;
      package_version: number;
      result: EvaluatedResult;
    }[]
  >`
    SELECT DISTINCT ON (cr.object_id)
      cr.object_id, o.name AS object_name, cr.id AS result_id, cr.run_id,
      cr.created_at AS evaluated_at, pv.version AS package_version,
      cr.result
    FROM completeness_results cr
    JOIN objects o ON o.id = cr.object_id
    JOIN package_versions pv ON pv.id = cr.package_version_id
    ORDER BY cr.object_id, cr.created_at DESC`;

  const totals = {
    applicable: 0,
    fulfilled: 0,
    fulfilled_required: 0,
    missing: 0,
    unverifiable: 0,
    not_applicable: 0,
  };
  const reasons: Record<string, number> = {};
  const scenarios: Record<string, number> = {};
  const stageStatus: Record<string, Record<string, number>> = {};
  const objects: unknown[] = [];

  for (const row of rows) {
    const evaluation = row.result;
    const counts = evaluation.counts ?? {};
    for (const key of Object.keys(totals) as (keyof typeof totals)[])
      totals[key] += counts[key] ?? 0;
    // Совместимость с результатами, записанными до появления сводки причин.
    const sourceReasons =
      counts.reasons ??
      Object.fromEntries(
        (evaluation.requirements ?? [])
          .flatMap((requirement) => requirement.reasons ?? [])
          .map((reason) => [reason, 1] as const)
          .reduce((acc, [reason, n]) => {
            acc.set(reason, (acc.get(reason) ?? 0) + n);
            return acc;
          }, new Map<string, number>()),
      );
    for (const [reason, n] of Object.entries(sourceReasons))
      reasons[reason] = (reasons[reason] ?? 0) + n;
    const scenario = evaluation.scenario ?? "UNKNOWN";
    scenarios[scenario] = (scenarios[scenario] ?? 0) + 1;
    for (const [stage, status] of Object.entries(evaluation.stages ?? {})) {
      if (!status?.status) continue;
      const bucket = (stageStatus[stage] ??= {});
      bucket[status.status] = (bucket[status.status] ?? 0) + 1;
    }
    objects.push({
      object_id: row.object_id,
      object: row.object_name,
      run_id: row.run_id,
      package_version: row.package_version,
      evaluated_at: row.evaluated_at.toISOString(),
      scenario,
      counts,
    });
  }

  const applicableRequired = rows.reduce((sum, row) => {
    const requirements = row.result.requirements ?? [];
    return sum + requirements.length;
  }, 0);

  log("objects_evaluated", rows.length);
  log("objects", objects);
  log("totals", totals);
  log("fulfilled_pct", {
    all: totals.applicable
      ? +(100 * (totals.fulfilled / totals.applicable)).toFixed(1)
      : null,
    required: totals.applicable
      ? +(
          100 *
          ((totals.fulfilled_required || totals.fulfilled) / totals.applicable)
        ).toFixed(1)
      : null,
    requirements_rows: applicableRequired,
  });
  log(
    "unverifiable_pct",
    totals.applicable
      ? +(100 * (totals.unverifiable / totals.applicable)).toFixed(1)
      : null,
  );
  log("reasons", reasons);
  log("scenarios", scenarios);
  log("stage_status", stageStatus);
  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
