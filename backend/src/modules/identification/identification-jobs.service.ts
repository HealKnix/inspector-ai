import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type {
  IdentificationTask,
  Prisma,
} from "../../generated/prisma/client.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { ObjectAccessService } from "../objects/object-access.service.js";
import { ArtifactStorageService } from "../parsing/artifact-storage.service.js";
import type { ClassificationResult } from "./classification-contract.js";
import type { IdentifiedRevision } from "./identification-contract.js";
import { identifyArtifact } from "./identification-engine.js";
import { identificationSources } from "./identification-state.js";
import { IdentificationService } from "./identification.service.js";

@Injectable()
export class IdentificationJobsService {
  private recoveryCursor: string | null = null;
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ObjectAccessService,
    private readonly artifacts: ArtifactStorageService,
    private readonly identification: IdentificationService,
  ) {}

  private async lockedSources(tx: Prisma.TransactionClient, runId: string) {
    const run = await tx.run.findUnique({ where: { id: runId } });
    if (!run) return null;
    await this.access.lock(tx, run.objectId);
    await tx.$queryRaw`SELECT id FROM processes WHERE id=${run.processId}::uuid FOR UPDATE`;
    const source = await identificationSources(tx, runId);
    if (
      source.run.version !== source.run.process.version ||
      source.run.process.status === "FINALIZED"
    )
      return null;
    return source;
  }

  private async enqueue(
    tx: Prisma.TransactionClient,
    task: IdentificationTask,
  ) {
    await tx.outbox.create({
      data: {
        eventType: "identification.requested",
        availableAt: task.availableAt,
        payload: {
          schema_version: 1,
          event_type: "identification.requested",
          task_id: task.id,
        },
      },
    });
    await tx.identificationTask.update({
      where: { id: task.id },
      data: { dispatchedAt: new Date() },
    });
  }

  async recover() {
    const runs = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT r.id FROM runs r JOIN processes p ON p.id=r.process_id
      WHERE r.version=p.version AND p.status<>'FINALIZED'
        AND (${this.recoveryCursor}::uuid IS NULL OR r.id>${this.recoveryCursor}::uuid)
      ORDER BY r.id LIMIT 100`;
    // Continue through all current runs over recovery ticks. A permanently
    // pending older run must not be hidden behind the same newest 100 rows.
    this.recoveryCursor =
      runs.length === 100 ? runs[runs.length - 1]!.id : null;
    for (const { id } of runs)
      await this.prisma.$transaction(
        async (tx) => {
          const source = await this.lockedSources(tx, id);
          if (!source?.ready) return;
          if (
            await tx.resolvedInputSnapshot.findUnique({
              where: {
                runId_sourceFingerprint: {
                  runId: id,
                  sourceFingerprint: source.fingerprint,
                },
              },
            })
          )
            return;
          const prior = await tx.identificationTask.findUnique({
            where: {
              runId_fingerprint: { runId: id, fingerprint: source.fingerprint },
            },
          });
          if (prior) return;
          const task = await tx.identificationTask.create({
            data: {
              runId: id,
              processId: source.run.processId,
              objectId: source.run.objectId,
              fingerprint: source.fingerprint,
            },
          });
          await this.enqueue(tx, task);
        },
        { timeout: 20_000 },
      );
    const expired = await this.prisma.identificationTask.findMany({
      where: { state: "processing", leaseUntil: { lt: new Date() } },
      take: 25,
    });
    for (const task of expired)
      await this.failed(task, "identification_lease_expired");
    const queued = await this.prisma.identificationTask.findMany({
      where: {
        state: "queued",
        availableAt: { lte: new Date() },
        OR: [
          { dispatchedAt: null },
          { dispatchedAt: { lt: new Date(Date.now() - 60_000) } },
        ],
      },
      take: 25,
    });
    for (const task of queued)
      await this.prisma.$transaction(async (tx) => {
        const source = await this.lockedSources(tx, task.runId);
        const current = await tx.identificationTask.findUniqueOrThrow({
          where: { id: task.id },
        });
        if (current.state !== "queued") return;
        if (!source?.ready || source.fingerprint !== current.fingerprint) {
          await tx.identificationTask.update({
            where: { id: current.id },
            data: {
              state: "failed",
              errorCode: "identification_superseded",
              completedAt: new Date(),
            },
          });
          return;
        }
        await this.enqueue(tx, current);
      });
  }

  async execute(taskId: string, signal?: AbortSignal) {
    const claimed = await this.prisma.$transaction(
      async (tx) => {
        const task = await tx.identificationTask.findUnique({
          where: { id: taskId },
        });
        if (!task) return null;
        const source = await this.lockedSources(tx, task.runId);
        const current = await tx.identificationTask.findUniqueOrThrow({
          where: { id: taskId },
        });
        if (
          !source?.ready ||
          source.fingerprint !== task.fingerprint ||
          current.state !== "queued" ||
          current.availableAt.getTime() > Date.now()
        )
          return null;
        const owned = await tx.identificationTask.update({
          where: { id: taskId },
          data: {
            state: "processing",
            attempts: { increment: 1 },
            leaseToken: randomUUID(),
            leaseUntil: new Date(Date.now() + 120_000),
            errorCode: null,
          },
        });
        return { source, owned };
      },
      { timeout: 20_000 },
    );
    if (!claimed) return;
    const identified: { fileId: string; machine: IdentifiedRevision }[] = [];
    try {
      for (const input of claimed.source.sources) {
        if (signal?.aborted) throw new Error("identification_interrupted");
        if (
          !input.artifact ||
          input.parsing?.state !== "succeeded" ||
          input.file.corruptedAt
        )
          continue;
        const artifact = await this.artifacts.read(
          input.artifact.storageKey,
          input.artifact.artifactSha256,
          input.file.sha256,
          input.artifact.pipelineFingerprint,
          "stored",
        );
        identified.push({
          fileId: input.file.id,
          machine: identifyArtifact({
            representation: {
              file_id: input.file.id,
              artifact_id: input.artifact.id,
              artifact_sha256: input.artifact.artifactSha256,
              source_sha256: input.file.sha256,
              format: input.file.format,
              page_count: input.artifact.pagesTotal,
            },
            artifact,
            classification: input.classification
              ?.result as ClassificationResult | null,
          }),
        });
        // Extend only the current lease; a timed-out/reclaimed worker cannot resurrect it.
        const renewed = await this.prisma.identificationTask.updateMany({
          where: {
            id: claimed.owned.id,
            state: "processing",
            leaseToken: claimed.owned.leaseToken,
            leaseUntil: { gt: new Date() },
          },
          data: { leaseUntil: new Date(Date.now() + 120_000) },
        });
        if (!renewed.count) return;
      }
    } catch {
      await this.failed(
        claimed.owned,
        signal?.aborted
          ? "identification_interrupted"
          : "identification_source_unavailable",
      );
      return;
    }
    await this.prisma.$transaction(
      async (tx) => {
        const source = await this.lockedSources(tx, claimed.owned.runId);
        const task = await tx.identificationTask.findUniqueOrThrow({
          where: { id: claimed.owned.id },
        });
        if (
          task.state !== "processing" ||
          task.leaseToken !== claimed.owned.leaseToken ||
          !task.leaseUntil ||
          task.leaseUntil.getTime() <= Date.now()
        )
          return;
        if (
          !source?.ready ||
          source.fingerprint !== task.fingerprint ||
          signal?.aborted
        ) {
          await tx.identificationTask.update({
            where: { id: task.id },
            data: {
              state: "failed",
              errorCode: "identification_superseded",
              leaseUntil: null,
              leaseToken: null,
              completedAt: new Date(),
            },
          });
          return;
        }
        await this.identification.publish(tx, source, identified);
        await tx.identificationTask.update({
          where: { id: task.id },
          data: {
            state: "succeeded",
            leaseUntil: null,
            leaseToken: null,
            completedAt: new Date(),
          },
        });
      },
      { timeout: 60_000 },
    );
  }

  private async failed(owned: IdentificationTask, code: string) {
    await this.prisma.$transaction(async (tx) => {
      const source = await this.lockedSources(tx, owned.runId);
      const task = await tx.identificationTask.findUniqueOrThrow({
        where: { id: owned.id },
      });
      if (task.state !== "processing" || task.leaseToken !== owned.leaseToken)
        return;
      const retry = Boolean(
        source?.ready &&
        source.fingerprint === task.fingerprint &&
        task.attempts < 3,
      );
      const next = await tx.identificationTask.update({
        where: { id: task.id },
        data: {
          state: retry ? "queued" : "failed",
          errorCode: code,
          leaseUntil: null,
          leaseToken: null,
          availableAt: new Date(Date.now() + 1000 * 4 ** task.attempts),
          completedAt: retry ? null : new Date(),
        },
      });
      if (retry) await this.enqueue(tx, next);
      else
        await tx.outbox.create({
          data: {
            eventType: "identification.failed",
            payload: {
              schema_version: 1,
              event_type: "identification.failed",
              task_id: task.id,
              run_id: task.runId,
              error_code: code,
            },
          },
        });
    });
  }
}
