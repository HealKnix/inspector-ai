import { Injectable, Logger } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { ParsingTask, Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { PrivateStorageService } from "../../infrastructure/storage/private-storage.service.js";
import { canonicalJson } from "../documents/canonical-json.js";
import { ObjectAccessService } from "../objects/object-access.service.js";
import { ArtifactStorageService } from "./artifact-storage.service.js";
import { ParserClientService } from "./parser-client.service.js";
import { ParsingCacheService } from "./parsing-cache.service.js";
import {
  ParsingError,
  UUID,
  record,
  validateArtifact,
  type ParseArtifactData,
  type ParsingMessage,
} from "./parsing-contract.js";

export const FILE_QUEUE = "inspector.parsing.files";
export const PARENT_QUEUE = "inspector.documents.accepted";
const retryDelay = (attempt: number) =>
  Math.min(60_000, 1000 * 4 ** (attempt - 1));
const capacityDelay = (deferrals: number) =>
  Math.min(60_000, 5000 * 2 ** Math.min(deferrals, 4));

@Injectable()
export class ParsingJobsService {
  private readonly logger = new Logger(ParsingJobsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ObjectAccessService,
    private readonly storage: PrivateStorageService,
    private readonly artifacts: ArtifactStorageService,
    private readonly parser: ParserClientService,
    private readonly cache: ParsingCacheService,
  ) {}

  async enqueue(tx: Prisma.TransactionClient, task: ParsingTask) {
    const eventId = randomUUID();
    await tx.outbox.create({
      data: {
        id: eventId,
        eventType: "parsing.requested",
        availableAt: task.availableAt,
        payload: {
          schema_version: 1,
          event_id: eventId,
          event_type: "parsing.requested",
          task_id: task.id,
          run_id: task.runId,
          process_id: task.processId,
          object_id: task.objectId,
          file_id: task.fileId,
          cycle: task.cycle,
        },
      },
    });
    await tx.parsingTask.update({
      where: { id: task.id },
      data: { dispatchedAt: new Date() },
    });
  }

  async fanout(message: unknown) {
    if (
      !record(message) ||
      message.schema_version !== 1 ||
      message.event_type !== "documents.accepted"
    )
      throw new ParsingError("invalid_queue_message", false);
    for (const key of ["job_id", "run_id", "process_id", "object_id"])
      if (typeof message[key] !== "string" || !UUID.test(message[key]))
        throw new ParsingError("invalid_queue_message", false);
    return this.fanoutJob(String(message.job_id), message);
  }

  private async fanoutJob(jobId: string, message?: Record<string, unknown>) {
    return this.prisma.$transaction(
      async (tx) => {
        const job = await tx.job.findUnique({
          where: { id: jobId },
          include: { run: true },
        });
        if (!job || job.kind !== "document.parsing")
          throw new ParsingError("invalid_queue_message", false);
        if (
          message &&
          (message.run_id !== job.runId ||
            message.process_id !== job.processId ||
            message.object_id !== job.objectId ||
            message.input_manifest_hash !== job.run.inputManifestHash)
        )
          throw new ParsingError("invalid_queue_message", false);
        await this.access.lock(tx, job.objectId);
        await tx.$queryRaw`SELECT id FROM processes WHERE id = ${job.processId}::uuid FOR UPDATE`;
        const process = await tx.process.findUniqueOrThrow({
          where: { id: job.processId },
        });
        if (
          process.version !== job.run.version ||
          !["PENDING", "PARSING"].includes(process.status)
        )
          return;
        const inputs = await tx.runInput.findMany({
          where: { runId: job.runId },
        });
        for (const input of inputs) {
          if (
            await tx.parsingTask.findFirst({
              where: { runId: job.runId, fileId: input.fileId },
            })
          )
            continue;
          const task = await tx.parsingTask.create({
            data: {
              runId: job.runId,
              fileId: input.fileId,
              processId: job.processId,
              objectId: job.objectId,
            },
          });
          await this.enqueue(tx, task);
        }
        if (
          await tx.parsingTask.count({
            where: {
              runId: job.runId,
              state: { in: ["queued", "processing"] },
            },
          })
        )
          await tx.process.update({
            where: { id: job.processId },
            data: { status: "PARSING" },
          });
      },
      { timeout: 20_000 },
    );
  }

  // Runs admitted before installation and lost deliveries are recovered from PG.
  // No successful record or original is changed and no job id is recreated.
  async recover() {
    const parents = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT j.id FROM jobs j JOIN runs r ON r.id=j.run_id JOIN processes p ON p.id=r.process_id
      WHERE j.kind='document.parsing' AND r.version=p.version AND p.status IN ('PENDING','PARSING')
      AND EXISTS (SELECT 1 FROM run_inputs i WHERE i.run_id=r.id AND NOT EXISTS
        (SELECT 1 FROM parsing_tasks t WHERE t.run_id=i.run_id AND t.file_id=i.file_id))
      ORDER BY j.created_at LIMIT 20`;
    for (const parent of parents) await this.fanoutJob(parent.id);
    const expired = await this.prisma.parsingTask.findMany({
      where: { state: "processing", leaseUntil: { lt: new Date() } },
      take: 20,
    });
    for (const task of expired)
      await this.finishFailure(
        task,
        new ParsingError("worker_lease_expired", true),
        true,
      );
    const queued = await this.prisma.parsingTask.findMany({
      where: {
        state: "queued",
        availableAt: { lte: new Date() },
        OR: [
          { dispatchedAt: null },
          { dispatchedAt: { lt: new Date(Date.now() - 60_000) } },
        ],
      },
      take: 20,
    });
    for (const task of queued)
      await this.prisma.$transaction(async (tx) => {
        await this.access.lock(tx, task.objectId);
        await tx.$queryRaw`SELECT id FROM processes WHERE id=${task.processId}::uuid FOR UPDATE`;
        const current = await tx.parsingTask.findUniqueOrThrow({
          where: { id: task.id },
          include: { run: { include: { process: true } } },
        });
        if (current.state !== "queued") return;
        if (
          current.run.version !== current.run.process.version ||
          !["PENDING", "PARSING"].includes(current.run.process.status)
        ) {
          await tx.parsingTask.update({
            where: { id: task.id },
            data: {
              state: "failed",
              errorCode: "stale_run",
              completedAt: new Date(),
            },
          });
          await this.event(tx, current, "parsing.failed", "stale_run");
        } else if (
          !current.dispatchedAt ||
          current.dispatchedAt.getTime() < Date.now() - 60_000
        )
          await this.enqueue(tx, current);
      });
  }

  async claim(message: ParsingMessage) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, message.object_id);
      await tx.$queryRaw`SELECT id FROM processes WHERE id=${message.process_id}::uuid FOR UPDATE`;
      const task = await tx.parsingTask.findUnique({
        where: { id: message.task_id },
        include: { run: { include: { process: true } }, file: true },
      });
      if (
        !task ||
        task.objectId !== message.object_id ||
        task.runId !== message.run_id ||
        task.processId !== message.process_id ||
        task.fileId !== message.file_id ||
        task.cycle !== message.cycle
      )
        throw new ParsingError("invalid_queue_message", false);
      if (
        task.state !== "queued" ||
        task.attempts >= 3 ||
        task.availableAt.getTime() > Date.now() ||
        task.run.version !== task.run.process.version ||
        !["PENDING", "PARSING"].includes(task.run.process.status)
      )
        return null;
      const token = randomUUID();
      const leaseMs = this.parser.timeoutMs + 30_000;
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        UPDATE parsing_tasks SET state='processing',attempts=attempts+1,lease_token=${token}::uuid,
          lease_until=now()+${leaseMs}*interval '1 millisecond',error_code=NULL,pages_completed=0,pages_total=NULL
        WHERE id=${task.id}::uuid AND state='queued' AND attempts<3 AND available_at<=now()
          AND NOT EXISTS(SELECT 1 FROM parsing_tasks newer WHERE newer.run_id=parsing_tasks.run_id AND newer.file_id=parsing_tasks.file_id AND newer.cycle>parsing_tasks.cycle)
        RETURNING id`;
      if (!claimed.length) return null;
      await tx.process.update({
        where: { id: task.processId },
        data: { status: "PARSING" },
      });
      return {
        ...task,
        state: "processing",
        attempts: task.attempts + 1,
        leaseToken: token,
      };
    });
  }

  private async fenced(
    tx: Prisma.TransactionClient,
    task: ParsingTask,
    expired = false,
  ) {
    await this.access.lock(tx, task.objectId);
    await tx.$queryRaw`SELECT id FROM processes WHERE id=${task.processId}::uuid FOR UPDATE`;
    const rows = expired
      ? await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM parsing_tasks WHERE id=${task.id}::uuid AND lease_token=${task.leaseToken}::uuid AND state='processing' AND lease_until < now() FOR UPDATE`
      : await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM parsing_tasks WHERE id=${task.id}::uuid AND lease_token=${task.leaseToken}::uuid AND state='processing' AND lease_until > now() FOR UPDATE`;
    if (!rows.length) return null;
    const current = await tx.parsingTask.findUniqueOrThrow({
      where: { id: task.id },
      include: { run: { include: { process: true } }, file: true },
    });
    const newer = await tx.parsingTask.count({
      where: {
        runId: task.runId,
        fileId: task.fileId,
        cycle: { gt: task.cycle },
      },
    });
    return {
      current,
      isCurrent:
        !newer &&
        current.run.version === current.run.process.version &&
        current.run.process.status === "PARSING",
    };
  }

  private async settle(tx: Prisma.TransactionClient, task: ParsingTask) {
    const [remaining] = await tx.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) FROM parsing_tasks t WHERE t.run_id=${task.runId}::uuid AND t.state IN ('queued','processing')
      AND NOT EXISTS(SELECT 1 FROM parsing_tasks n WHERE n.run_id=t.run_id AND n.file_id=t.file_id AND n.cycle>t.cycle)`;
    if (remaining?.count === 0n)
      await tx.$executeRaw`
      UPDATE processes p SET status='PENDING' WHERE p.id=${task.processId}::uuid AND p.status='PARSING'
      AND EXISTS(SELECT 1 FROM runs r WHERE r.id=${task.runId}::uuid AND r.process_id=p.id AND r.version=p.version)`;
  }

  private async event(
    tx: Prisma.TransactionClient,
    task: ParsingTask,
    type: string,
    code?: string,
  ) {
    const eventId = randomUUID();
    const details = {
      schema_version: 1,
      task_id: task.id,
      object_id: task.objectId,
      process_id: task.processId,
      run_id: task.runId,
      file_id: task.fileId,
      cycle: task.cycle,
      attempt: task.attempts,
      pipeline_fingerprint: task.pipelineFingerprint,
      ...(code ? { error_code: code, notify_role: "ADMINISTRATOR" } : {}),
    };
    await tx.outbox.create({
      data: {
        id: eventId,
        eventType: type,
        payload: {
          ...details,
          event_id: eventId,
          event_type: type,
          occurred_at: new Date().toISOString(),
        },
      },
    });
    const file = await tx.file.findUniqueOrThrow({
      where: { id: task.fileId },
      select: { uploadedBy: true },
    });
    await tx.auditEvent.create({
      data: {
        userId: file.uploadedBy,
        objectId: task.objectId,
        requestId: task.leaseToken ?? eventId,
        action: type,
        details: { ...details, actor: "parsing-worker" },
      },
    });
  }

  async finishFailure(task: ParsingTask, error: ParsingError, expired = false) {
    return this.prisma.$transaction(async (tx) => {
      const fence = await this.fenced(tx, task, expired);
      if (!fence) return false;
      const code = fence.isCurrent ? error.code : "stale_run";
      if (fence.isCurrent && error.code === "parser_busy" && !expired) {
        // /parse refused admission: no document work began. Broker redelivery
        // cannot repeat this decrement because the lease is cleared atomically.
        const deferred = await tx.parsingTask.update({
          where: { id: task.id },
          data: {
            state: "queued",
            attempts: { decrement: 1 },
            capacityDeferrals: { increment: 1 },
            errorCode: "parser_busy",
            leaseToken: null,
            leaseUntil: null,
            completedAt: null,
            availableAt: new Date(
              Date.now() + capacityDelay(fence.current.capacityDeferrals),
            ),
          },
        });
        await this.enqueue(tx, deferred);
        return true;
      }
      const retry =
        fence.isCurrent && error.retryable && fence.current.attempts < 3;
      const updated = await tx.parsingTask.update({
        where: { id: task.id },
        data: {
          state: retry ? "queued" : "failed",
          errorCode: code,
          leaseToken: null,
          leaseUntil: null,
          availableAt: new Date(
            Date.now() + retryDelay(fence.current.attempts),
          ),
          completedAt: retry ? null : new Date(),
        },
      });
      if (retry) await this.enqueue(tx, updated);
      else {
        await this.event(tx, fence.current, "parsing.failed", code);
        if (fence.isCurrent) await this.settle(tx, task);
      }
      return true;
    });
  }

  async execute(message: ParsingMessage, shutdownSignal?: AbortSignal) {
    const task = await this.claim(message);
    if (!task) return;
    const controller = new AbortController();
    const signal = shutdownSignal
      ? AbortSignal.any([controller.signal, shutdownSignal])
      : controller.signal;
    const timeout = setTimeout(() => controller.abort(), this.parser.timeoutMs);
    let progressBusy = false;
    const progressTimer = setInterval(() => {
      if (progressBusy) return;
      progressBusy = true;
      void (async () => {
        const owners = await this.prisma.$queryRaw<{ id: string }[]>`
          SELECT t.id FROM parsing_tasks t JOIN runs r ON r.id=t.run_id JOIN processes p ON p.id=t.process_id
          WHERE t.id=${task.id}::uuid AND t.state='processing' AND t.lease_token=${task.leaseToken}::uuid
            AND t.lease_until>now() AND r.version=p.version AND p.status='PARSING'`;
        if (!owners.length) {
          controller.abort();
          return;
        }
        const progress = await this.parser.progress(task.leaseToken);
        if (progress) {
          const updated = await this.prisma
            .$executeRaw`UPDATE parsing_tasks SET pages_completed=${progress.completed},pages_total=${progress.total}
            WHERE id=${task.id}::uuid AND state='processing' AND lease_token=${task.leaseToken}::uuid AND lease_until>now()`;
          if (!updated) controller.abort();
        }
      })()
        .catch(() => controller.abort())
        .finally(() => {
          progressBusy = false;
        });
    }, 2000);
    const started = Date.now();
    try {
      const manifest = task.run.inputManifest;
      if (
        !record(manifest) ||
        manifest.schema_version !== 1 ||
        manifest.object_id !== task.objectId ||
        manifest.process_id !== task.processId ||
        manifest.run_id !== task.runId ||
        createHash("sha256").update(canonicalJson(manifest)).digest("hex") !==
          task.run.inputManifestHash ||
        !Array.isArray(manifest.files) ||
        manifest.files.filter(
          (entry: unknown) =>
            record(entry) &&
            entry.file_id === task.fileId &&
            entry.file_hash === task.file.sha256,
        ).length !== 1
      )
        throw new ParsingError("input_manifest_invalid", false);
      if (
        task.file.corruptedAt ||
        (await this.storage.hash(task.file.storageKey)) !== task.file.sha256
      )
        throw new ParsingError("original_integrity_failed", false);
      const fingerprint = await this.parser.fingerprint();
      task.pipelineFingerprint = fingerprint;
      await this.prisma.parsingTask.updateMany({
        where: {
          id: task.id,
          leaseToken: task.leaseToken,
          state: "processing",
        },
        data: { pipelineFingerprint: fingerprint },
      });
      const cachedId =
        task.cycle === 1
          ? await this.cache.get(task.file.sha256, fingerprint)
          : null;
      const cached =
        task.cycle === 1
          ? await this.prisma.parseArtifact.findFirst({
              where: {
                sourceSha256: task.file.sha256,
                pipelineFingerprint: fingerprint,
                ...(cachedId ? { id: cachedId } : {}),
              },
              orderBy: { createdAt: "desc" },
            })
          : null;
      let candidate: ParseArtifactData | undefined;
      if (cached) {
        try {
          candidate = await this.artifacts.read(
            cached.storageKey,
            cached.artifactSha256,
            task.file.sha256,
            fingerprint,
          );
          await this.artifacts.verifyImages(candidate, signal);
        } catch {
          candidate = undefined;
        }
      }
      const reused = candidate !== undefined;
      if (!candidate) {
        candidate = validateArtifact(
          await this.parser.parse(
            {
              request_id: task.leaseToken,
              storage_key: task.file.storageKey,
              source_sha256: task.file.sha256,
              format: task.file.format.toLowerCase(),
            },
            signal,
          ),
          task.file.sha256,
          fingerprint,
        );
        await this.artifacts.verifyImages(candidate, signal);
      }
      const artifact = candidate;
      if (signal.aborted) throw new ParsingError("parser_timeout", true);
      const durable = await this.artifacts.write(artifact);
      const committed = await this.prisma.$transaction(async (tx) => {
        const fence = await this.fenced(tx, task);
        if (
          !fence?.isCurrent ||
          fence.current.file.sha256 !== artifact.source_sha256 ||
          fence.current.file.corruptedAt ||
          fence.current.pipelineFingerprint !== artifact.pipeline_fingerprint
        )
          return null;
        const saved = await tx.parseArtifact.create({
          data: {
            taskId: task.id,
            sourceSha256: artifact.source_sha256,
            pipelineFingerprint: artifact.pipeline_fingerprint,
            ...durable,
            quality: artifact.quality,
            reasons: artifact.reasons,
            pagesTotal: artifact.pages.length,
          },
        });
        await tx.parsingTask.update({
          where: { id: task.id },
          data: {
            state: "succeeded",
            completedAt: new Date(),
            leaseToken: null,
            leaseUntil: null,
            pagesCompleted: artifact.pages.length,
            pagesTotal: artifact.pages.length,
            errorCode: null,
          },
        });
        await this.event(tx, fence.current, "parsing.succeeded");
        await this.settle(tx, task);
        return saved;
      });
      if (committed)
        await this.cache.put(task.file.sha256, fingerprint, committed.id);
      this.logger.log(
        JSON.stringify({
          event: committed ? "parsing.finished" : "parsing.stale_rejected",
          task_id: task.id,
          run_id: task.runId,
          object_id: task.objectId,
          attempt: task.attempts,
          duration_ms: Date.now() - started,
          cache_hit: reused,
        }),
      );
    } catch (error) {
      const outcome =
        error instanceof ParsingError
          ? error
          : new ParsingError("source_or_storage_unavailable", true);
      await this.finishFailure(task, outcome);
      this.logger.warn(
        JSON.stringify({
          event:
            outcome.code === "parser_busy"
              ? "parsing.capacity.deferred"
              : "parsing.attempt.failed",
          task_id: task.id,
          run_id: task.runId,
          attempt: task.attempts,
          error_code: outcome.code,
          duration_ms: Date.now() - started,
        }),
      );
    } finally {
      clearTimeout(timeout);
      clearInterval(progressTimer);
    }
  }
}
