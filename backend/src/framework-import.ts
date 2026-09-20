import { NestFactory } from "@nestjs/core";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "reflect-metadata";
import { AppModule } from "./app.module.js";
import type { Prisma } from "./generated/prisma/client.js";
import { PrismaService } from "./infrastructure/prisma/prisma.service.js";

const SOURCE = resolve(__dirname, "../scripts/framework-v1.jsonl");

interface MetaRow {
  kind: "meta";
  title: string;
  scope: string;
  sources: string;
}
interface VocabularyRow {
  kind: "vocabulary";
  vocab: string;
  code: string;
  title: string;
  norm_ref?: string;
  values?: string[];
}
interface RequirementRow {
  kind: "requirement";
  code: string;
  stage: string;
  kind_code: string;
  title: string;
  norm_ref: string;
  applicability?: unknown;
  quantity: unknown;
  alternatives?: unknown;
}
interface MappingRow {
  kind: "mapping";
  matrix_section: string;
  stage: string;
  code: string | null;
  source_text?: string;
}
type Row = MetaRow | VocabularyRow | RequirementRow | MappingRow;

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readRows(): { meta: MetaRow; rows: Row[] } {
  const rows = readFileSync(SOURCE, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Row);
  const meta = rows.find((row): row is MetaRow => row.kind === "meta");
  if (!meta) throw new Error("В источнике нет строки meta");
  return { meta, rows };
}

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
      const sourceSha256 = sha256(SOURCE);
      const { meta, rows } = readRows();
      await prisma.$transaction(async (tx) => {
        const existing = await tx.frameworkSet.findUnique({
          where: { sourceSha256 },
        });
        if (existing) {
          process.stdout.write(
            `Импорт уже выполнен: framework_set v${existing.version} (${existing.status})\n`,
          );
          return;
        }
        const last = await tx.frameworkSet.findFirst({
          orderBy: { version: "desc" },
        });
        const set = await tx.frameworkSet.create({
          data: {
            version: (last?.version ?? 0) + 1,
            status: "draft",
            note: `${meta.title}\n${meta.scope}\nИсточники: ${meta.sources}`,
            sourceName: "framework-v1.jsonl",
            sourceSha256,
            createdBy: actor.login,
          },
        });
        const counts = { vocab: 0, requirements: 0, mappings: 0 };
        for (const row of rows) {
          if (row.kind === "vocabulary") {
            await tx.frameworkVocabulary.create({
              data: {
                setId: set.id,
                kind: row.vocab,
                code: row.code,
                title: row.title,
                normRef: row.norm_ref ?? null,
              },
            });
            counts.vocab += 1;
          } else if (row.kind === "requirement") {
            await tx.frameworkRequirement.create({
              data: {
                setId: set.id,
                code: row.code,
                stage: row.stage,
                kindCode: row.kind_code,
                title: row.title,
                normRef: row.norm_ref,
                applicability: (row.applicability ??
                  null) as Prisma.InputJsonValue,
                quantity: row.quantity as Prisma.InputJsonValue,
                alternatives: (row.alternatives ??
                  null) as Prisma.InputJsonValue,
              },
            });
            counts.requirements += 1;
          } else if (row.kind === "mapping") {
            await tx.frameworkSectionMapping.create({
              data: {
                setId: set.id,
                matrixSection: row.matrix_section,
                stage: row.stage,
                code: row.code,
                sourceText: row.source_text ?? null,
              },
            });
            counts.mappings += 1;
          }
        }
        await tx.auditEvent.create({
          data: {
            ...auditBase,
            action: "framework.imported",
            details: {
              schema_version: 1,
              framework_set_id: set.id,
              version: set.version,
              source_sha256: sourceSha256,
              ...counts,
            },
          },
        });
        process.stdout.write(
          `Импортирован каркас v${set.version} (draft): ${counts.vocab} словарных кодов, ${counts.requirements} требований, ${counts.mappings} соответствий\n`,
        );
      });
    } else if (command === "approve") {
      if (!actor || actor.role !== "ADMINISTRATOR" || !auditBase)
        throw new Error(
          "Утверждение требует логин администратора: approve <login>",
        );
      await prisma.$transaction(async (tx) => {
        const draft = await tx.frameworkSet.findFirst({
          where: { status: "draft" },
          orderBy: { version: "desc" },
        });
        if (!draft) throw new Error("Нет каркаса в статусе draft");
        await tx.frameworkSet.update({
          where: { id: draft.id },
          data: {
            status: "approved",
            approvedBy: actor.login,
            approvedAt: new Date(),
          },
        });
        await tx.auditEvent.create({
          data: {
            ...auditBase,
            action: "framework.approved",
            details: {
              schema_version: 1,
              framework_set_id: draft.id,
              version: draft.version,
            },
          },
        });
        process.stdout.write(`Каркас v${draft.version} утверждён\n`);
      });
    } else {
      throw new Error("Команды: import <login> | approve <login>");
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
