import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { PrivateStorageService } from "../../infrastructure/storage/private-storage.service.js";
import {
  ObjectAccessService,
  type AuditContext,
} from "../objects/object-access.service.js";
import { ArtifactStorageService } from "./artifact-storage.service.js";
import type { Quality } from "./parsing-contract.js";
import { ParsingJobsService } from "./parsing-jobs.service.js";
import type { ParsingPhase, WaitingReason } from "./parsing-progress.js";

interface ParsingRow {
  file_id: string;
  process_id: string;
  run_id: string;
  original_name: string;
  state: "queued" | "processing" | "succeeded" | "failed";
  attempt: number;
  pages_completed: number;
  pages_total: number | null;
  quality: Quality | null;
  reasons: string[];
  error_code: string | null;
  can_retry: boolean;
  artifact_id: string | null;
  phase: ParsingPhase | null;
  progress_updated_at: Date | null;
  waiting_reason: WaitingReason | null;
  retry_at: Date | null;
  checkpoint_validated: boolean | null;
  checkpoint_pages: number | null;
  current_page: number | null;
  previous_attempt_error: string | null;
  progress_reset_reason:
    "pipeline_version_changed" | "saved_pages_unavailable" | null;
}

@Injectable()
export class ParsingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ObjectAccessService,
    private readonly storage: PrivateStorageService,
    private readonly artifacts: ArtifactStorageService,
    private readonly jobs: ParsingJobsService,
  ) {}
  async list(userId: string, objectId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, userId, objectId);
      const items = await tx.$queryRaw<ParsingRow[]>`
        SELECT f.id AS file_id,p.id AS process_id,r.id AS run_id,f.original_name,
          COALESCE(t.state,'queued') AS state,COALESCE(t.attempts,0) AS attempt,
          COALESCE(t.pages_completed,0) AS pages_completed,t.pages_total,a.quality,
          COALESCE(a.reasons,ARRAY[]::text[]) AS reasons,t.error_code,
          t.phase,t.progress_updated_at,t.waiting_reason,t.checkpoint_validated,t.checkpoint_pages,t.current_page,t.previous_attempt_error,t.progress_reset_reason,
          CASE WHEN t.state='queued' AND t.waiting_reason IS NOT NULL THEN t.available_at ELSE NULL END AS retry_at,
          (t.state IN ('succeeded','failed') AND p.status IN ('PENDING','PARSING') AND f.corrupted_at IS NULL) AS can_retry,a.id AS artifact_id
        FROM processes p JOIN runs r ON r.process_id=p.id AND r.version=p.version
        JOIN run_inputs ri ON ri.run_id=r.id JOIN files f ON f.id=ri.file_id
        LEFT JOIN LATERAL(SELECT * FROM parsing_tasks pt WHERE pt.run_id=r.id AND pt.file_id=f.id ORDER BY cycle DESC LIMIT 1) t ON true
        LEFT JOIN parse_artifacts a ON a.task_id=t.id AND t.state='succeeded'
        WHERE p.object_id=${objectId}::uuid ORDER BY p.created_at DESC,f.created_at,f.id`;
      return {
        schema_version: 1 as const,
        active: items.some(
          (item) => item.state === "queued" || item.state === "processing",
        ),
        poll_after_ms: 2000,
        items: items.map((item) => ({
          ...item,
          can_retry: Boolean(item.can_retry),
        })),
      };
    });
  }

  private async current(
    tx: Prisma.TransactionClient,
    objectId: string,
    fileId: string,
  ) {
    const file = await tx.file.findFirst({ where: { id: fileId, objectId } });
    if (!file) throw new NotFoundException("Файл недоступен");
    const process = await tx.process.findUniqueOrThrow({
      where: { id: file.processId },
    });
    const run = await tx.run.findUnique({
      where: {
        processId_version: { processId: process.id, version: process.version },
      },
    });
    const task = run
      ? await tx.parsingTask.findFirst({
          where: { fileId, runId: run.id, objectId },
          orderBy: { cycle: "desc" },
          include: { artifact: true },
        })
      : null;
    return { file, process, run, task };
  }
  private async publishedState(
    tx: Prisma.TransactionClient,
    objectId: string,
    fileId: string,
    expectedArtifact?: string,
  ) {
    const { file, run, task } = await this.current(tx, objectId, fileId);
    if (file.corruptedAt)
      throw new ServiceUnavailableException("Нарушена целостность оригинала");
    if (
      !task?.artifact ||
      task.state !== "succeeded" ||
      !run ||
      (expectedArtifact && expectedArtifact !== task.artifact.id)
    )
      throw new ConflictException(
        "Результат текущего запуска ещё недоступен или изменился",
      );
    if (task.artifact.sourceSha256 !== file.sha256)
      throw new ServiceUnavailableException("Нарушена целостность результата");
    return { file, run, metadata: task.artifact };
  }
  private async published(
    userId: string,
    objectId: string,
    fileId: string,
    expectedArtifact?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, userId, objectId);
      return this.publishedState(tx, objectId, fileId, expectedArtifact);
    });
  }
  private async publishedAsAdmin(fileId: string, expectedArtifact?: string) {
    return this.prisma.$transaction(async (tx) => {
      const owner = await tx.file.findUnique({ where: { id: fileId } });
      if (!owner) throw new NotFoundException("Файл недоступен");
      await this.access.lock(tx, owner.objectId);
      return this.publishedState(tx, owner.objectId, fileId, expectedArtifact);
    });
  }
  private async readArtifact(
    acquire: () => Promise<{
      file: { sha256: string };
      run: { id: string };
      metadata: {
        id: string;
        storageKey: string;
        artifactSha256: string;
        pipelineFingerprint: string;
      };
    }>,
    confirm: (artifactId: string) => Promise<unknown>,
  ) {
    const { file, run, metadata } = await acquire();
    try {
      const artifact = await this.artifacts.read(
        metadata.storageKey,
        metadata.artifactSha256,
        file.sha256,
        metadata.pipelineFingerprint,
        "stored",
      );
      await confirm(metadata.id);
      return {
        artifact_id: metadata.id,
        run_id: run.id,
        artifact,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("Сохранённый результат недоступен");
    }
  }
  async artifact(userId: string, objectId: string, fileId: string) {
    const result = await this.readArtifact(
      () => this.published(userId, objectId, fileId),
      (expected) => this.published(userId, objectId, fileId, expected),
    );
    return { ...result, file_id: fileId };
  }
  async adminArtifact(fileId: string) {
    const result = await this.readArtifact(
      () => this.publishedAsAdmin(fileId),
      (expected) => this.publishedAsAdmin(fileId, expected),
    );
    return { ...result, file_id: fileId };
  }
  private async readPage(
    pageNumber: number,
    acquire: (expectedArtifact?: string) => Promise<{
      file: { sha256: string };
      metadata: {
        id: string;
        storageKey: string;
        artifactSha256: string;
        pipelineFingerprint: string;
      };
    }>,
  ) {
    const { file, metadata } = await acquire();
    try {
      const artifact = await this.artifacts.read(
        metadata.storageKey,
        metadata.artifactSha256,
        file.sha256,
        metadata.pipelineFingerprint,
        "stored",
      );
      const page = artifact.pages.find(
        (item) => item.page_number === pageNumber,
      );
      if (!page) throw new NotFoundException("Страница не найдена");
      const bytes = await this.artifacts.image(page);
      await acquire(metadata.id);
      return { bytes, artifactId: metadata.id };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException("Сохранённая страница недоступна");
    }
  }
  async page(
    userId: string,
    objectId: string,
    fileId: string,
    pageNumber: number,
    expectedArtifact?: string,
  ) {
    return this.readPage(pageNumber, (expected) =>
      this.published(userId, objectId, fileId, expected ?? expectedArtifact),
    );
  }
  async adminPage(
    fileId: string,
    pageNumber: number,
    expectedArtifact?: string,
  ) {
    return this.readPage(pageNumber, (expected) =>
      this.publishedAsAdmin(fileId, expected ?? expectedArtifact),
    );
  }

  async retry(
    context: AuditContext,
    objectId: string,
    fileId: string,
    requestId: string,
  ) {
    const preflight = await this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, context.userId, objectId);
      const receipt = await tx.parsingRetryReceipt.findUnique({
        where: {
          userId_objectId_requestId: {
            userId: context.userId,
            objectId,
            requestId,
          },
        },
        include: { task: true },
      });
      if (receipt) {
        if (receipt.task.fileId !== fileId)
          throw new ConflictException("Ключ повтора относится к другому файлу");
        return { receipt, current: null };
      }
      return {
        receipt: null,
        current: await this.current(tx, objectId, fileId),
      };
    });
    if (preflight.receipt)
      return { request_id: requestId, task_id: preflight.receipt.taskId };
    const original = preflight.current.file;
    try {
      if (
        original.corruptedAt ||
        (await this.storage.hash(original.storageKey)) !== original.sha256
      )
        throw new Error();
    } catch {
      throw new ConflictException(
        "Нарушена целостность оригинала. Загрузите исправленный файл.",
      );
    }
    return this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, context.userId, objectId);
      await tx.$queryRaw`SELECT id FROM processes WHERE id=${original.processId}::uuid FOR UPDATE`;
      const receipt = await tx.parsingRetryReceipt.findUnique({
        where: {
          userId_objectId_requestId: {
            userId: context.userId,
            objectId,
            requestId,
          },
        },
        include: { task: true },
      });
      if (receipt) {
        if (receipt.task.fileId !== fileId)
          throw new ConflictException("Ключ повтора относится к другому файлу");
        return { request_id: requestId, task_id: receipt.taskId };
      }
      const { task, run, file, process } = await this.current(
        tx,
        objectId,
        fileId,
      );
      if (
        !run ||
        !task ||
        !["succeeded", "failed"].includes(task.state) ||
        !["PENDING", "PARSING"].includes(process.status) ||
        file.corruptedAt ||
        file.sha256 !== original.sha256 ||
        run.id !== preflight.current?.run?.id
      )
        throw new ConflictException(
          "Повтор сейчас недоступен: файл обрабатывается или запуск изменился",
        );
      const next = await tx.parsingTask.create({
        data: {
          runId: run.id,
          fileId,
          objectId,
          processId: process.id,
          cycle: task.cycle + 1,
        },
      });
      await this.jobs.enqueue(tx, next);
      await tx.process.update({
        where: { id: process.id },
        data: { status: "PARSING" },
      });
      await tx.parsingRetryReceipt.create({
        data: { userId: context.userId, objectId, requestId, taskId: next.id },
      });
      await tx.auditEvent.create({
        data: {
          ...context,
          objectId,
          action: "parsing.retry.requested",
          details: {
            schema_version: 1,
            file_id: fileId,
            run_id: run.id,
            task_id: next.id,
            cycle: next.cycle,
            retry_request_id: requestId,
          },
        },
      });
      return { request_id: requestId, task_id: next.id };
    });
  }
}
