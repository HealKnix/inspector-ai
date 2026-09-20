import { NestFactory } from "@nestjs/core";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "reflect-metadata";
import { AppModule } from "./app.module.js";
import type { Prisma } from "./generated/prisma/client.js";
import { PrismaService } from "./infrastructure/prisma/prisma.service.js";
import { validateExtractionPlan } from "./modules/extraction/extraction-contract.js";

const CATALOG = resolve(__dirname, "../scripts/matrix-132.jsonl");
// SHA-256 of docs/requirements/matrix-132.xlsx — the authoritative source the
// JSONL catalog was derived from. Verified at import time, not assumed.
const ORIGIN_XLSX = resolve(
  __dirname,
  "../../docs/requirements/matrix-132.xlsx",
);

interface CatalogRow {
  [key: string]: string | number | null;
  parameter_id: number;
  parameter_code: string;
  pd_section: string;
  name: string;
  unit: string | null;
  source_pd: string | null;
  source_rd: string | null;
  source_id: string | null;
  trigger: string;
  criticality: string | null;
  matrix_row: number;
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

// Initial approved rules for the demonstrator slice (EXT §7): three operators —
// table_lookup, cascade with regex fallback, enum. The rest of the 132
// parameters stay unsupported until their plans are drafted and approved.
const SEED_RULES: { parameter_code: string; note: string; plan: unknown }[] = [
  {
    parameter_code: "P002",
    note: "seed: ТЭП-таблица, строка «общая площадь», последняя числовая ячейка",
    plan: {
      kind: "table_lookup",
      signature: {
        any: ["показател", "значение"],
        caption: ["технико-экономические", "тэп"],
        min_score: 2,
      },
      row: { anchors: ["общая площадь"] },
      value: {
        column: "last_numeric",
        type: "number",
        unit: ["м2", "м²", "кв.м"],
      },
    },
  },
  {
    parameter_code: "P007",
    note: "seed: этажность — ТЭП-строка, иначе regex «N этаж» по тексту",
    plan: {
      kind: "cascade",
      steps: [
        {
          kind: "table_lookup",
          signature: { any: ["показател"], min_score: 1 },
          row: { anchors: ["этажность", "этажей"] },
          value: { column: "last_numeric", type: "number" },
        },
        {
          kind: "regex",
          anchors: ["этажность", "этажей"],
          pattern: "(\\d+)\\s*(?:-?этаж|\\(эт\\)|эт\\.)",
          window_blocks: 1,
          type: "number",
        },
      ],
    },
  },
  {
    parameter_code: "P015",
    note: "seed: категория надёжности — enum по тексту рядом с якорем",
    plan: {
      kind: "regex",
      anchors: ["категори", "надежност", "надёжност", "электроснабжен"],
      pattern:
        "(i{1,3}v?|[123]|перв(?:ая|ой)|втор(?:ая|ой)|треть(?:я|ей))\\s*категори|категори[яию]\\s*[:-]?\\s*(i{1,3}v?|[123]|перв(?:ая|ую)|втор(?:ая|ую)|треть(?:я|ю))",
      window_blocks: 2,
      type: "enum",
      enum: ["i", "ii", "iii", "1", "2", "3"],
    },
  },
];

async function main() {
  const [command, login] = process.argv.slice(2);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const prisma = app.get(PrismaService);
  // CLI mutations are attributed to the named administrator for audit.
  const actor = login
    ? await prisma.user.findUniqueOrThrow({
        where: { login: login.toLowerCase() },
      })
    : null;
  const auditBase = actor
    ? { userId: actor.id, requestId: randomUUID() }
    : null;
  try {
    if (command === "import") {
      if (!actor || actor.role !== "ADMINISTRATOR" || !auditBase)
        throw new Error("Импорт требует логин администратора: import <login>");
      const sourceSha256 = sha256(CATALOG);
      const originSha256 = sha256(ORIGIN_XLSX);
      const rows = readFileSync(CATALOG, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as CatalogRow);
      if (rows.length !== 132)
        throw new Error(
          `Ожидалось 132 строки каталога, получено ${rows.length}`,
        );
      await prisma.$transaction(async (tx) => {
        const existing = await tx.matrixImport.findUnique({
          where: { sourceSha256 },
        });
        if (existing) {
          process.stdout.write(`Импорт уже выполнен: ${existing.id}\n`);
          return;
        }
        const imported = await tx.matrixImport.create({
          data: {
            sourceName: "matrix-132.jsonl",
            sourceSha256,
            originSha256,
            rowCount: rows.length,
            importedBy: actor.login,
          },
        });
        for (const row of rows) {
          await tx.matrixRow.create({
            data: {
              importId: imported.id,
              parameterId: row.parameter_id,
              parameterCode: row.parameter_code,
              pdSection: row.pd_section,
              name: row.name,
              unit: row.unit,
              sourcePd: row.source_pd,
              sourceRd: row.source_rd,
              sourceId: row.source_id,
              triggerText: row.trigger,
              criticality: row.criticality,
              matrixRow: row.matrix_row,
              raw: row,
            },
          });
        }
        await tx.auditEvent.create({
          data: {
            ...auditBase,
            action: "matrix.imported",
            details: {
              schema_version: 1,
              import_id: imported.id,
              source_sha256: sourceSha256,
              origin_sha256: originSha256,
              row_count: rows.length,
            },
          },
        });
        process.stdout.write(
          `Импортировано ${rows.length} строк, import_id=${imported.id}\n`,
        );
      });
    } else if (command === "seed-rules") {
      if (!actor || actor.role !== "ADMINISTRATOR" || !auditBase)
        throw new Error(
          "Сид правил требует логин администратора: seed-rules <login>",
        );
      await prisma.$transaction(async (tx) => {
        for (const seed of SEED_RULES) {
          const row = await tx.matrixRow.findFirst({
            where: { parameterCode: seed.parameter_code },
            orderBy: { importId: "desc" },
          });
          if (!row)
            throw new Error(
              `Строка ${seed.parameter_code} отсутствует — сначала выполните import`,
            );
          const plan = validateExtractionPlan(seed.plan);
          const existing = await tx.ruleVersion.findFirst({
            where: { parameterCode: seed.parameter_code, version: 1 },
          });
          if (existing) {
            process.stdout.write(
              `${seed.parameter_code}: версия 1 уже есть (${existing.status}), пропуск\n`,
            );
            continue;
          }
          await tx.ruleVersion.create({
            data: {
              parameterCode: seed.parameter_code,
              parameterId: row.parameterId,
              version: 1,
              status: "approved",
              plan: JSON.parse(JSON.stringify(plan)) as Prisma.InputJsonValue,
              note: seed.note,
              createdBy: "matrix-seed",
              approvedBy: "matrix-seed",
              approvedAt: new Date(),
            },
          });
          process.stdout.write(
            `${seed.parameter_code}: правило v1 утверждено\n`,
          );
        }
        await tx.auditEvent.create({
          data: {
            ...auditBase,
            action: "matrix.rules.seeded",
            details: {
              schema_version: 1,
              parameter_codes: SEED_RULES.map((rule) => rule.parameter_code),
            },
          },
        });
      });
    } else {
      throw new Error("Команды: import <login> | seed-rules <login>");
    }
  } finally {
    await app.close();
  }
}

void main().catch((error) => {
  process.stderr.write(
    `Ошибка: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
