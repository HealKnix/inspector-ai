import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import {
  ObjectAccessService,
  type AuditContext,
} from "../objects/object-access.service.js";
import type { ClassificationResult } from "./classification-contract.js";
import { ClassificationJobsService } from "./classification-jobs.service.js";

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
}

@Injectable()
export class ClassificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ObjectAccessService,
    private readonly jobs: ClassificationJobsService,
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
      return {
        schema_version: 1,
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
      await tx.auditEvent.create({
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
