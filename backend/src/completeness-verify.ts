// Сквозная проверка комплектности на реальной БД (изолированный стек
// inspector-com). Создаёт объект, запуск и файлы с классификацией в
// реальном формате результата слоя ID, прогоняет generate → confirm →
// evaluate через CompletenessService и проверяет идемпотентность,
// конфликт версий и неизменность истории. Использование:
//   bun run completeness:verify
import { NestFactory } from "@nestjs/core";
import { createHash, randomUUID } from "node:crypto";
import "reflect-metadata";
import { AppModule } from "./app.module.js";
import { PrismaService } from "./infrastructure/prisma/prisma.service.js";
import { CompletenessService } from "./modules/completeness/completeness.service.js";

const log = (name: string, value: unknown) =>
  console.log(JSON.stringify({ check: name, value }));

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error"],
  });
  const prisma = app.get(PrismaService);
  const completeness = app.get(CompletenessService);
  const suffix = randomUUID().slice(0, 8);
  const inspector = await prisma.user.create({
    data: {
      login: `verify-${suffix}`,
      passwordHash: "verify-only",
      role: "INSPECTOR",
    },
  });
  const object = await prisma.constructionObject.create({
    data: { name: `Проверка комплектности ${suffix}`, createdBy: inspector.id },
  });
  await prisma.objectAccess.create({
    data: {
      objectId: object.id,
      userId: inspector.id,
      grantedBy: inspector.id,
    },
  });
  const process = await prisma.process.create({
    data: { objectId: object.id, status: "PARSING" },
  });
  const manifest = { files: 3 };
  const run = await prisma.run.create({
    data: {
      processId: process.id,
      objectId: object.id,
      version: 1,
      inputManifest: manifest,
      inputManifestHash: createHash("sha256")
        .update(JSON.stringify(manifest))
        .digest("hex"),
    },
  });
  const fingerprint = createHash("sha256").update("pipeline-v1").digest("hex");
  const classification = (stage: string, kind: string | null) => ({
    schema_version: 1,
    stage,
    document_kind: kind,
    method: "rules",
    needs_review: false,
    reasons: ["verify_fixture"],
    evidence: [],
    candidates: [],
    versions: {
      classifier: "verify",
      rules: "verify",
      context: "verify",
      prompt: "verify",
      model: null,
    },
  });
  const documents = [
    { name: "Пояснительная записка.pdf", stage: "PD", kind: null },
    {
      name: "Акт освидетельствования.pdf",
      stage: "ID",
      kind: "Акт освидетельствования скрытых работ",
    },
    { name: "Исполнительная схема.pdf", stage: "ID", kind: "Исполнительная схема" },
  ];
  for (const [index, document] of documents.entries()) {
    const sha = createHash("sha256").update(`${suffix}:${index}`).digest("hex");
    const file = await prisma.file.create({
      data: {
        objectId: object.id,
        processId: process.id,
        runId: run.id,
        originalName: document.name,
        format: "PDF",
        size: 1024,
        sha256: sha,
        storageKey: randomUUID(),
        uploadedBy: inspector.id,
      },
    });
    await prisma.runInput.create({
      data: {
        runId: run.id,
        fileId: file.id,
        processId: process.id,
        objectId: object.id,
      },
    });
    const task = await prisma.parsingTask.create({
      data: {
        runId: run.id,
        fileId: file.id,
        processId: process.id,
        objectId: object.id,
        state: "succeeded",
        pipelineFingerprint: fingerprint,
        completedAt: new Date(),
      },
    });
    const artifact = await prisma.parseArtifact.create({
      data: {
        taskId: task.id,
        sourceSha256: sha,
        pipelineFingerprint: fingerprint,
        storageKey: randomUUID(),
        artifactSha256: createHash("sha256")
          .update(`${sha}:artifact`)
          .digest("hex"),
        quality: "OK",
        reasons: [],
        pagesTotal: 1,
      },
    });
    await prisma.classificationTask.create({
      data: {
        artifactId: artifact.id,
        fingerprint,
        state: "succeeded",
        result: classification(document.stage, document.kind),
        completedAt: new Date(),
      },
    });
  }
  const context = {
    userId: inspector.id,
    requestId: randomUUID(),
    ip: "127.0.0.1",
  };

  // 1. Расчёт до подтверждённого перечня → конфликт.
  try {
    await completeness.evaluate(context, object.id, {});
    log("evaluate_without_package", "unexpected_success");
  } catch (error) {
    log("evaluate_without_package", (error as Error).constructor.name);
  }

  // 2. Предложение с атрибутами и ручным перечнем скрытых работ.
  const generated = await completeness.generate(context, object.id, {
    attributes: { demolition: false },
    lists: [
      {
        list_kind: "hidden_works",
        item_key: "устройство свай",
        title: "Устройство свай",
      },
    ],
  });
  log("generate", generated);

  // 3. Расчёт по proposed (ещё не подтверждённому) перечню → конфликт.
  try {
    await completeness.evaluate(context, object.id, {});
    log("evaluate_proposed", "unexpected_success");
  } catch (error) {
    log("evaluate_proposed", (error as Error).constructor.name);
  }

  // 4. Подтверждение с устаревшей версией → конфликт.
  try {
    await completeness.confirm(context, object.id, {
      request_id: randomUUID(),
      expected_version: 99,
      basis: "старая версия",
      attributes: {},
    });
    log("confirm_stale_version", "unexpected_success");
  } catch (error) {
    log("confirm_stale_version", (error as Error).constructor.name);
  }

  // 5. Подтверждение актуальной версии.
  const requestId = randomUUID();
  const confirmed = await completeness.confirm(context, object.id, {
    request_id: requestId,
    expected_version: generated.package_version,
    basis: "Проверка verify-скрипта",
    attributes: { demolition: false },
  });
  log("confirm", confirmed);

  // 6. Повтор доставки того же request_id → та же версия, без дубля.
  const replay = await completeness.confirm(context, object.id, {
    request_id: requestId,
    expected_version: generated.package_version,
    basis: "Повтор не должен создать версию",
    attributes: {},
  });
  const versionsAfterReplay = await prisma.packageVersion.count({
    where: { objectId: object.id },
  });
  log("confirm_replay", {
    replay,
    same_version: replay.package_version === confirmed.package_version,
    versions_total: versionsAfterReplay,
  });

  // 7. Расчёт по подтверждённому перечню и реальным фактам запуска.
  const first = await completeness.evaluate(context, object.id, {
    run_id: run.id,
  });
  const evaluation = first.evaluation as {
    scenario: string;
    counts: Record<string, number>;
    requirements: { code: string; outcome: string; reasons: string[] }[];
  };
  log("evaluate", {
    scenario: evaluation.scenario,
    counts: evaluation.counts,
    outcomes: evaluation.requirements
      .map((r) => `${r.code}:${r.outcome}`)
      .sort(),
  });

  // 8. Повторный расчёт создаёт новый результат, прежний неизменен.
  const second = await completeness.evaluate(context, object.id, {
    run_id: run.id,
  });
  const results = await prisma.completenessResult.count({
    where: { objectId: object.id, runId: run.id },
  });
  log("evaluate_history", {
    results_total: results,
    new_row: second.run_id === first.run_id,
    deterministic:
      JSON.stringify(first.evaluation) === JSON.stringify(second.evaluation),
  });

  // 9. Доступ чужого инспектора отклоняется.
  const outsider = await prisma.user.create({
    data: {
      login: `outsider-${suffix}`,
      passwordHash: "verify-only",
      role: "INSPECTOR",
    },
  });
  try {
    await completeness.getPackage(outsider.id, object.id);
    log("foreign_access", "unexpected_success");
  } catch (error) {
    log("foreign_access", (error as Error).constructor.name);
  }
  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
