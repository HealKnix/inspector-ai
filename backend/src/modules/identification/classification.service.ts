import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client.js";
import { writeAuditEvent } from "../../infrastructure/audit/audit-envelope.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import {
  ObjectAccessService,
  type AuditContext,
} from "../objects/object-access.service.js";
import type {
  ClassificationResult,
  ClassificationStage,
} from "./classification-contract.js";
import { ClassificationJobsService } from "./classification-jobs.service.js";
import {
  classificationReview,
  type ClassificationReview,
  type ClassificationReviewSnapshot,
} from "./classification-review.js";
import { identificationSources } from "./identification-state.js";
import { IdentificationService } from "./identification.service.js";

export interface ClassificationRow {
  file_id: string;
  process_id: string;
  run_id: string;
  artifact_id: string;
  original_name: string;
  task_id: string | null;
  state: "queued" | "processing" | "succeeded" | "failed";
  can_retry: boolean;
  error_code: string | null;
  result: ClassificationResult | null;
  review?: ClassificationReview | null;
}

@Injectable()
export class ClassificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ObjectAccessService,
    private readonly jobs: ClassificationJobsService,
    private readonly identification: IdentificationService,
  ) {}

  async list(userId: string, objectId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, userId, objectId);
      const items = await tx.$queryRaw<ClassificationRow[]>`
        SELECT f.id AS file_id,p.id AS process_id,r.id AS run_id,a.id AS artifact_id,
          f.original_name,c.id AS task_id,COALESCE(c.state,'queued') AS state,
          COALESCE((c.state IN ('succeeded','failed') OR c.fingerprint<>${this.jobs.fingerprint}) AND p.status IN ('PENDING','PARSING'),false) AS can_retry,
          CASE WHEN c.fingerprint<>${this.jobs.fingerprint} THEN 'classification_configuration_changed' ELSE c.error_code END AS error_code,c.result
        FROM processes p JOIN runs r ON r.process_id=p.id AND r.version=p.version
        JOIN run_inputs ri ON ri.run_id=r.id JOIN files f ON f.id=ri.file_id
        JOIN LATERAL (SELECT * FROM parsing_tasks pt WHERE pt.run_id=r.id AND pt.file_id=f.id ORDER BY cycle DESC LIMIT 1) t ON t.state='succeeded'
        JOIN parse_artifacts a ON a.task_id=t.id AND a.source_sha256=f.sha256
        LEFT JOIN LATERAL (SELECT * FROM classification_tasks ct WHERE ct.artifact_id=a.id ORDER BY cycle DESC LIMIT 1) c ON true
        WHERE p.object_id=${objectId}::uuid AND f.corrupted_at IS NULL
          AND (c.id IS NOT NULL OR p.status IN ('PENDING','PARSING'))
        ORDER BY p.created_at DESC,f.created_at,f.id`;
      let identificationActive = false;
      for (const runId of new Set(items.map((item) => item.run_id))) {
        const selection = await IdentificationService.readSnapshot(tx, runId);
        const sources = await identificationSources(tx, runId);
        const current = Boolean(
          selection &&
          sources?.ready &&
          sources.run.version === sources.run.process.version &&
          selection.inputManifestHash === sources.run.inputManifestHash &&
          selection.sourceFingerprint === sources.fingerprint,
        );
        if (!current) {
          const task = await tx.identificationTask.findUnique({
            where: {
              runId_fingerprint: { runId, fingerprint: sources.fingerprint },
            },
          });
          const sourceWorkActive =
            sources.sources.some((source) =>
              ["queued", "processing"].includes(source.parsing?.state ?? ""),
            ) ||
            items.some(
              (item) =>
                item.run_id === runId &&
                ["queued", "processing"].includes(item.state) &&
                item.error_code !== "classification_configuration_changed",
            );
          identificationActive ||=
            sources.run.process.status !== "FINALIZED" &&
            task?.state !== "failed" &&
            (sources.ready || sourceWorkActive);
        }
        for (const item of items.filter((row) => row.run_id === runId))
          item.review =
            current && selection && sources
              ? classificationReview(
                  selection.snapshot as unknown as ClassificationReviewSnapshot,
                  selection.resolvedInputHash,
                  item.file_id,
                  item.artifact_id,
                  item.result,
                  sources.decisions,
                )
              : null;
      }
      return {
        schema_version: 1,
        review_active: identificationActive,
        active: items.some(
          (item) =>
            ["queued", "processing"].includes(item.state) &&
            item.error_code !== "classification_configuration_changed",
        ),
        poll_after_ms: 2000,
        items,
      };
    });
  }

  // Виды словаря каркаса, которым соответствует стадия документа. SET —
  // шаблон генератора марок РД, а не вид документа, в выбор и валидацию
  // не входит.
  private static readonly VOCAB_STAGE: Record<string, ClassificationStage> = {
    pd_section: "PD",
    rd_mark: "RD",
    rd_component: "RD",
    id_kind: "ID",
  };

  private async kindVocabulary(tx: Prisma.TransactionClient) {
    const set = await tx.frameworkSet.findFirst({
      where: { status: "approved" },
      orderBy: { version: "desc" },
      include: { vocabularies: true },
    });
    const byCode = new Map<
      string,
      { title: string; stages: Set<ClassificationStage> }
    >();
    for (const entry of set?.vocabularies ?? []) {
      const stage = ClassificationService.VOCAB_STAGE[entry.kind];
      if (!stage || entry.code === "SET") continue;
      const current = byCode.get(entry.code) ?? {
        title: entry.title,
        stages: new Set<ClassificationStage>(),
      };
      current.stages.add(stage);
      byCode.set(entry.code, current);
    }
    return byCode;
  }

  async kindOptions(userId: string, objectId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, userId, objectId);
      const byCode = await this.kindVocabulary(tx);
      const options: Record<
        ClassificationStage,
        { code: string; title: string }[]
      > = { PD: [], RD: [], ID: [] };
      for (const [code, entry] of byCode)
        for (const stage of entry.stages)
          options[stage].push({ code, title: entry.title });
      for (const list of Object.values(options))
        list.sort((a, b) => a.title.localeCompare(b.title, "ru-RU"));
      return { schema_version: 1, options };
    });
  }

  // Legacy URL is a bridge to the versioned document-resolution workflow.
  // It cannot overwrite a classifier result or bypass the new-Run boundary.
  async resolve(
    context: AuditContext,
    objectId: string,
    fileId: string,
    input: {
      request_id: string;
      expected_run_id: string;
      expected_version: number;
      basis: string;
      kind_code: string;
      stage: ClassificationStage;
    },
  ) {
    return this.identification.resolveKind(context, objectId, fileId, input);
  }

  async retry(
    context: AuditContext,
    objectId: string,
    fileId: string,
    requestId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, context.userId, objectId);
      const receipt = await tx.classificationRetryReceipt.findUnique({
        where: {
          userId_objectId_requestId: {
            userId: context.userId,
            objectId,
            requestId,
          },
        },
        include: {
          task: { include: { artifact: { include: { task: true } } } },
        },
      });
      if (receipt) {
        if (receipt.task.artifact.task.fileId !== fileId)
          throw new ConflictException("Ключ повтора относится к другому файлу");
        return { request_id: requestId, task_id: receipt.taskId };
      }
      const file = await tx.file.findFirst({ where: { id: fileId, objectId } });
      if (!file) throw new NotFoundException("Файл недоступен");
      await tx.$queryRaw`SELECT id FROM processes WHERE id=${file.processId}::uuid FOR UPDATE`;
      const process = await tx.process.findUniqueOrThrow({
        where: { id: file.processId },
      });
      const run = await tx.run.findUnique({
        where: {
          processId_version: {
            processId: process.id,
            version: process.version,
          },
        },
      });
      const parsed = run
        ? await tx.parsingTask.findFirst({
            where: { fileId, runId: run.id },
            orderBy: { cycle: "desc" },
            include: { artifact: true },
          })
        : null;
      if (
        !parsed?.artifact ||
        !(await this.jobs.current(tx, parsed.artifact.id)) ||
        !["PENDING", "PARSING"].includes(process.status)
      )
        throw new ConflictException(
          "Результат парсинга текущего запуска недоступен",
        );
      const previous = await tx.classificationTask.findFirst({
        where: { artifactId: parsed.artifact.id },
        orderBy: { cycle: "desc" },
      });
      if (
        !previous ||
        (previous.fingerprint === this.jobs.fingerprint &&
          !["succeeded", "failed"].includes(previous.state))
      )
        throw new ConflictException("Классификация ещё выполняется");
      const next = await tx.classificationTask.create({
        data: {
          artifactId: parsed.artifact.id,
          cycle: previous.cycle + 1,
          fingerprint: this.jobs.fingerprint,
        },
      });
      await this.jobs.enqueue(tx, next);
      await tx.classificationRetryReceipt.create({
        data: { userId: context.userId, objectId, requestId, taskId: next.id },
      });
      await writeAuditEvent(tx, {
        data: {
          ...context,
          objectId,
          action: "classification.retry.requested",
          details: {
            schema_version: 1,
            file_id: fileId,
            artifact_id: parsed.artifact.id,
            task_id: next.id,
            retry_request_id: requestId,
          },
        },
      });
      return { request_id: requestId, task_id: next.id };
    });
  }
}
