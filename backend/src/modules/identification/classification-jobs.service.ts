import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import type {
  ClassificationTask,
  Prisma,
} from "../../generated/prisma/client.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { ObjectAccessService } from "../objects/object-access.service.js";
import { ArtifactStorageService } from "../parsing/artifact-storage.service.js";
import { readClassificationConfig } from "./classification-config.js";
import {
  ClassificationError,
  type ClassificationResult,
} from "./classification-contract.js";
import {
  classificationFingerprint,
  classify,
} from "./classification-engine.js";

export const CLASSIFICATION_QUEUE = "inspector.classification.files";

@Injectable()
export class ClassificationJobsService {
  readonly config;
  readonly fingerprint;
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ObjectAccessService,
    private readonly artifacts: ArtifactStorageService,
    config: ConfigService,
  ) {
    this.config = readClassificationConfig(config);
    this.fingerprint = classificationFingerprint(this.config);
  }

  // Object -> process is the same lock order as ingestion and parsing. Recheck
  // after locking so a concurrent new Run/reparse cannot publish stale evidence.
  async current(tx: Prisma.TransactionClient, artifactId: string) {
    const artifact = await tx.parseArtifact.findUnique({
      where: { id: artifactId },
      include: { task: { include: { file: true, run: true } } },
    });
    if (!artifact) return null;
    const task = artifact.task;
    await this.access.lock(tx, task.objectId);
    await tx.$queryRaw`SELECT id FROM processes WHERE id=${task.processId}::uuid FOR UPDATE`;
    const process = await tx.process.findUniqueOrThrow({
      where: { id: task.processId },
    });
    const latest = await tx.parsingTask.findFirst({
      where: { runId: task.runId, fileId: task.fileId },
      orderBy: { cycle: "desc" },
    });
    const file = await tx.file.findUniqueOrThrow({
      where: { id: task.fileId },
    });
    if (
      task.run.version !== process.version ||
      latest?.id !== task.id ||
      latest.state !== "succeeded" ||
      file.corruptedAt ||
      file.sha256 !== artifact.sourceSha256
    )
      return null;
    return { artifact, task, file, process };
  }

  async enqueue(tx: Prisma.TransactionClient, task: ClassificationTask) {
    await tx.outbox.create({
      data: {
        eventType: "classification.requested",
        availableAt: task.availableAt,
        payload: {
          schema_version: 1,
          event_type: "classification.requested",
          task_id: task.id,
        },
      },
    });
    await tx.classificationTask.update({
      where: { id: task.id },
      data: { dispatchedAt: new Date() },
    });
  }

  // The parser's durable artifact is the source of scheduling. This also covers
  // files parsed before installation and a crash between publication and polling.
  async recover() {
    const missing = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT a.id FROM parse_artifacts a
      JOIN parsing_tasks t ON t.id=a.task_id JOIN runs r ON r.id=t.run_id
      JOIN processes p ON p.id=t.process_id JOIN files f ON f.id=t.file_id
      LEFT JOIN LATERAL (SELECT fingerprint FROM classification_tasks c WHERE c.artifact_id=a.id ORDER BY cycle DESC LIMIT 1) c ON true
      WHERE t.state='succeeded' AND r.version=p.version AND p.status IN ('PENDING','PARSING')
        AND f.corrupted_at IS NULL AND a.source_sha256=f.sha256
        AND NOT EXISTS (SELECT 1 FROM parsing_tasks newer WHERE newer.run_id=t.run_id AND newer.file_id=t.file_id AND newer.cycle>t.cycle)
        AND c.fingerprint IS NULL
      ORDER BY a.created_at LIMIT 25`;
    for (const { id } of missing) {
      await this.prisma.$transaction(async (tx) => {
        const context = await this.current(tx, id);
        if (
          !context ||
          !["PENDING", "PARSING"].includes(context.process.status)
        )
          return;
        const previous = await tx.classificationTask.findFirst({
          where: { artifactId: id },
          orderBy: { cycle: "desc" },
        });
        if (previous) return;
        const next = await tx.classificationTask.create({
          data: {
            artifactId: id,
            cycle: 1,
            fingerprint: this.fingerprint,
          },
        });
        await this.enqueue(tx, next);
      });
    }
    const expired = await this.prisma.classificationTask.findMany({
      where: {
        state: "processing",
        fingerprint: this.fingerprint,
        leaseUntil: { lt: new Date() },
      },
      take: 25,
    });
    for (const task of expired)
      await this.failure(task, "classification_lease_expired", true, true);
    const queued = await this.prisma.classificationTask.findMany({
      where: {
        state: "queued",
        fingerprint: this.fingerprint,
        availableAt: { lte: new Date() },
        OR: [
          { dispatchedAt: null },
          { dispatchedAt: { lt: new Date(Date.now() - 60_000) } },
        ],
      },
      take: 25,
    });
    for (const item of queued) {
      await this.prisma.$transaction(async (tx) => {
        const context = await this.current(tx, item.artifactId);
        const task = await tx.classificationTask.findUniqueOrThrow({
          where: { id: item.id },
        });
        const latest = await tx.classificationTask.findFirst({
          where: { artifactId: item.artifactId },
          orderBy: { cycle: "desc" },
        });
        if (
          task.state !== "queued" ||
          (task.dispatchedAt &&
            task.dispatchedAt.getTime() > Date.now() - 60_000)
        )
          return;
        if (
          !context ||
          latest?.id !== task.id ||
          !["PENDING", "PARSING"].includes(context.process.status)
        ) {
          await tx.classificationTask.update({
            where: { id: task.id },
            data: {
              state: "failed",
              errorCode: "classification_superseded",
              completedAt: new Date(),
            },
          });
          return;
        }
        await this.enqueue(tx, task);
      });
    }
  }

  async execute(taskId: string, signal?: AbortSignal) {
    if (signal?.aborted) return;
    const claimed = await this.prisma.$transaction(async (tx) => {
      const initial = await tx.classificationTask.findUnique({
        where: { id: taskId },
      });
      if (!initial) return null;
      const context = await this.current(tx, initial.artifactId);
      const task = await tx.classificationTask.findUniqueOrThrow({
        where: { id: taskId },
      });
      // A worker from an overlapping deployment must not fail another version's
      // task. Its matching worker can redispatch; config changes use explicit retry.
      if (
        task.fingerprint !== this.fingerprint ||
        task.state !== "queued" ||
        task.availableAt.getTime() > Date.now()
      )
        return null;
      const latest = await tx.classificationTask.findFirst({
        where: { artifactId: task.artifactId },
        orderBy: { cycle: "desc" },
      });
      if (
        !context ||
        latest?.id !== task.id ||
        !["PENDING", "PARSING"].includes(context.process.status)
      ) {
        await tx.classificationTask.update({
          where: { id: taskId },
          data: {
            state: "failed",
            errorCode: "classification_superseded",
            completedAt: new Date(),
          },
        });
        return null;
      }
      const owned = await tx.classificationTask.update({
        where: { id: task.id },
        data: {
          state: "processing",
          attempts: { increment: 1 },
          leaseToken: randomUUID(),
          leaseUntil: new Date(Date.now() + this.config.timeoutMs + 60_000),
          errorCode: null,
        },
      });
      return { owned, context };
    });
    if (!claimed) return;
    const { owned, context } = claimed;
    let result: ClassificationResult;
    try {
      const artifact = await this.artifacts.read(
        context.artifact.storageKey,
        context.artifact.artifactSha256,
        context.file.sha256,
        context.artifact.pipelineFingerprint,
        "stored",
      );
      result = await classify(
        artifact,
        context.file.format,
        this.config,
        signal,
      );
      if (signal?.aborted)
        throw new ClassificationError("classification_interrupted", true);
    } catch (error) {
      await this.failure(
        owned,
        error instanceof ClassificationError
          ? error.code
          : "classification_artifact_unavailable",
        error instanceof ClassificationError ? error.retryable : false,
      );
      return;
    }
    // Infrastructure failures must escape to broker/lease recovery rather than
    // being recorded as a permanent artifact/model error.
    await this.prisma.$transaction(async (tx) => {
      const current = await this.current(tx, owned.artifactId);
      const task = await tx.classificationTask.findUniqueOrThrow({
        where: { id: owned.id },
      });
      const latest = await tx.classificationTask.findFirst({
        where: { artifactId: owned.artifactId },
        orderBy: { cycle: "desc" },
      });
      if (
        task.state !== "processing" ||
        task.leaseToken !== owned.leaseToken ||
        !task.leaseUntil ||
        task.leaseUntil.getTime() <= Date.now()
      )
        return;
      if (
        !current ||
        latest?.id !== owned.id ||
        !["PENDING", "PARSING"].includes(current.process.status)
      ) {
        await tx.classificationTask.update({
          where: { id: owned.id },
          data: {
            state: "failed",
            leaseToken: null,
            leaseUntil: null,
            errorCode: "classification_superseded",
            completedAt: new Date(),
          },
        });
        return;
      }
      await tx.classificationTask.update({
        where: { id: owned.id },
        data: {
          state: "succeeded",
          result: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue,
          completedAt: new Date(),
          leaseToken: null,
          leaseUntil: null,
        },
      });
      await tx.outbox.create({
        data: {
          eventType: "classification.succeeded",
          payload: {
            schema_version: 1,
            task_id: owned.id,
            artifact_id: owned.artifactId,
            file_id: context.file.id,
            run_id: context.task.runId,
            object_id: context.task.objectId,
            classifier_fingerprint: this.fingerprint,
          },
        },
      });
    });
  }

  private async failure(
    owned: ClassificationTask,
    code: string,
    retryable: boolean,
    expired = false,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const context = await this.current(tx, owned.artifactId);
      const task = await tx.classificationTask.findUniqueOrThrow({
        where: { id: owned.id },
      });
      const latest = await tx.classificationTask.findFirst({
        where: { artifactId: owned.artifactId },
        orderBy: { cycle: "desc" },
      });
      if (
        task.state !== "processing" ||
        task.leaseToken !== owned.leaseToken ||
        (expired && task.leaseUntil && task.leaseUntil.getTime() > Date.now())
      )
        return;
      const valid = Boolean(
        context &&
        latest?.id === task.id &&
        ["PENDING", "PARSING"].includes(context.process.status),
      );
      const retry = valid && retryable && task.attempts < 3;
      const next = await tx.classificationTask.update({
        where: { id: task.id },
        data: {
          state: retry ? "queued" : "failed",
          errorCode: valid ? code : "classification_superseded",
          leaseToken: null,
          leaseUntil: null,
          completedAt: retry ? null : new Date(),
          availableAt: new Date(
            Date.now() + Math.min(60_000, 1000 * 4 ** task.attempts),
          ),
        },
      });
      if (retry) await this.enqueue(tx, next);
      else
        await tx.outbox.create({
          data: {
            eventType: "classification.failed",
            payload: {
              schema_version: 1,
              task_id: task.id,
              artifact_id: task.artifactId,
              error_code: next.errorCode,
            },
          },
        });
    });
  }
}
