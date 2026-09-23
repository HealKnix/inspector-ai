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
import { ClassificationService } from "./modules/identification/classification.service.js";
import { ArtifactStorageService } from "./modules/parsing/artifact-storage.service.js";
import type { ParseArtifactData } from "./modules/parsing/parsing-contract.js";

const log = (name: string, value: unknown) =>
  console.log(JSON.stringify({ check: name, value }));

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ["error"],
  });
  const prisma = app.get(PrismaService);
  const completeness = app.get(CompletenessService);
  const classificationService = app.get(ClassificationService);
  const artifacts = app.get(ArtifactStorageService);
  const suffix = randomUUID().slice(0, 8);
  const inspector = await prisma.user.create({
    data: {
      login: `verify-${suffix}`,
      passwordHash: "verify-only",
      role: "INSPECTOR",
      lastName: "Проверка",
      firstName: "Инспектор",
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
  const manifest = { files: 6 };
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
  const classification = (
    stage: string,
    kind: string | null,
    needsReview = false,
  ) => ({
    schema_version: 1,
    stage,
    document_kind: kind,
    method: "rules",
    needs_review: needsReview,
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
  // Минимальный валидный артефакт: одна страница, текст построчно в блоках.
  const makeArtifact = (sourceSha: string, text: string) =>
    ({
      schema_version: 1,
      source_sha256: sourceSha,
      pipeline_fingerprint: fingerprint,
      versions: { parser: "verify-v1" },
      raw_text: text,
      normalized_text: text,
      quality: "OK",
      reasons: [],
      coverage: { total_pages: 1, readable_pages: 1, unreadable_pages: 0 },
      pages: [
        {
          page_number: 1,
          sheet_label: null,
          width: 612,
          height: 792,
          image_key: randomUUID(),
          image_sha256: createHash("sha256")
            .update(`${sourceSha}:image`)
            .digest("hex"),
          quality: "OK",
          reasons: [],
          transform: {
            coordinate_space: "visible-page-normalized",
            renderer: "verify",
            render_width: 612,
            render_height: 792,
            media_box: [0, 0, 612, 792],
            crop_box: [0, 0, 612, 792],
            rotation: 0,
            pdf_to_visible: [1, 0, 0, 1, 0, 0],
            visible_to_pdf: [1, 0, 0, 1, 0, 0],
          },
          blocks: text.split("\n").map((line, index) => ({
            id: `b${index + 1}`,
            order: index + 1,
            kind: "text",
            raw_text: line,
            normalized_text: line,
            bbox: [0.05, 0.05 + index * 0.05, 0.9, 0.09 + index * 0.05],
            confidence: null,
            source: "native",
            structural_path: null,
            table_id: null,
            row: null,
            column: null,
            row_span: null,
            column_span: null,
          })),
        },
      ],
    }) satisfies ParseArtifactData;
  const documents = [
    {
      name: "Пояснительная записка.pdf",
      stage: "PD",
      kind: "Пояснительная записка",
      needsReview: false,
      text: "ПОЯСНИТЕЛЬНАЯ ЗАПИСКА\nРаздел 1\nОбщие данные\nПеречень работ, конструкций и участков сетей, подлежащих освидетельствованию:\n1. Уплотнение грунта\n2. Устройство свай\n3. Закладка трубопровода\n4. Гидроизоляция фундамента",
    },
    {
      name: "Акт освидетельствования.pdf",
      stage: "ID",
      kind: "Акт освидетельствования скрытых работ",
      needsReview: false,
      text: "АКТ ОСВИДЕТЕЛЬСТВОВАНИЯ СКРЫТЫХ РАБОТ № 12\nна уплотнение грунта под фундаментную плиту",
    },
    {
      name: "Исполнительная схема.pdf",
      stage: "ID",
      kind: "Исполнительная схема",
      needsReview: false,
      text: "ИСПОЛНИТЕЛЬНАЯ СХЕМА\nгеодезическая сеть объекта",
    },
    {
      name: "Журнал работ.pdf",
      stage: "ID",
      kind: "Общий и специальные журналы работ",
      needsReview: true,
      text: "ОБЩИЙ ЖУРНАЛ РАБОТ",
    },
    {
      name: "Акт испытания.pdf",
      stage: "ID",
      kind: "Акт испытания технических устройств и систем ИТО",
      needsReview: false,
      text: "АКТ ИСПЫТАНИЯ технических устройств и систем ИТО",
    },
    {
      name: "Неразобранный.pdf",
      stage: "ID",
      kind: null,
      needsReview: false,
      text: "повреждённый скан без читаемого текста",
    },
  ];
  const fileIds = new Map<string, string>();
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
    fileIds.set(document.name, file.id);
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
    const stored = await artifacts.write(makeArtifact(sha, document.text));
    const artifact = await prisma.parseArtifact.create({
      data: {
        taskId: task.id,
        sourceSha256: sha,
        pipelineFingerprint: fingerprint,
        storageKey: stored.storageKey,
        artifactSha256: stored.artifactSha256,
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
        result: classification(
          document.stage,
          document.kind,
          document.needsReview,
        ),
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

  // 2. Предложение с атрибутами; ручной пункт дублирует извлечённый из ПЗ —
  // проверяется дедупликация перечня.
  const generated = await completeness.generate(context, object.id, {
    attributes: { demolition: false },
    lists: [
      {
        list_kind: "hidden_works",
        item_key: "уплотнение грунта",
        title: "Уплотнение грунта",
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

  // 5. Подтверждение актуальной версии; ручное требование с min=2 при одном
  // акте испытания демонстрирует quantity_short.
  const requestId = randomUUID();
  const confirmed = await completeness.confirm(context, object.id, {
    request_id: requestId,
    expected_version: generated.package_version,
    basis: "Проверка verify-скрипта",
    attributes: { demolition: false },
    include: [
      {
        stage: "ID",
        kind_code: "TEST_ACT",
        title: "Акты испытания устройств и систем",
        quantity: { min: 2 },
      },
    ],
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

  // 6.5. Ручное разрешение вида: «Исполнительная схема» (неоднозначный вид) →
  // GEO_SCHEME новым циклом классификации. Повтор с тем же видом не создаёт
  // цикл; код не из словаря и неоднозначный код без стадии отклоняются.
  const schemeFileId = fileIds.get("Исполнительная схема.pdf")!;
  const resolved = await classificationService.resolve(
    context,
    object.id,
    schemeFileId,
    { kind_code: "GEO_SCHEME" },
  );
  const resolvedReplay = await classificationService.resolve(
    context,
    object.id,
    schemeFileId,
    { kind_code: "GEO_SCHEME" },
  );
  log("resolve_kind", { resolved, replay: resolvedReplay });
  try {
    await classificationService.resolve(context, object.id, schemeFileId, {
      kind_code: "NO_SUCH_CODE",
    });
    log("resolve_unknown_code", "unexpected_success");
  } catch (error) {
    log("resolve_unknown_code", (error as Error).constructor.name);
  }
  try {
    await classificationService.resolve(context, object.id, schemeFileId, {
      kind_code: "АР",
    });
    log("resolve_ambiguous_code", "unexpected_success");
  } catch (error) {
    log("resolve_ambiguous_code", (error as Error).constructor.name);
  }

  // 7. Расчёт по подтверждённому перечню и реальным фактам запуска.
  const first = await completeness.evaluate(context, object.id, {
    run_id: run.id,
  });
  const evaluation = first.evaluation as {
    scenario: string;
    counts: Record<string, number> & { reasons: Record<string, number> };
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
      lastName: "Проверка",
      firstName: "Посторонний",
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
