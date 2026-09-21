import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { ExtractionTask, Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import type { ClassificationResult } from "../identification/classification-contract.js";
import { ObjectAccessService } from "../objects/object-access.service.js";
import { ArtifactStorageService } from "../parsing/artifact-storage.service.js";
import { validateComparisonSpec } from "./comparison-contract.js";
import { evaluateGroup } from "./comparison-engine.js";
import {
  validateExtractionPlan,
  type ExtractionOutcome,
} from "./extraction-contract.js";
import {
  executeArtifact,
  rulesetFingerprint,
  type ApprovedRule,
} from "./extraction-engine.js";

export const EXTRACTION_QUEUE = "inspector.extraction.artifacts";

// Extraction is pure CPU work over a stored artifact; the lease only bounds
// crash recovery. 120s comfortably covers the largest parsed documents.
const LEASE_MS = 120_000;
const ACTIVE_STATUSES = ["PENDING", "PARSING", "READY", "VERIFYING"];

@Injectable()
export class ExtractionJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ObjectAccessService,
    private readonly artifacts: ArtifactStorageService,
  ) {}

  /** Newest approved RuleVersion per parameter; drafts are never executed. */
  async approvedRules(
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<ApprovedRule[]> {
    const versions = await tx.ruleVersion.findMany({
      where: { status: "approved" },
      orderBy: [{ parameterCode: "asc" }, { version: "desc" }],
    });
    const latest = new Map<string, (typeof versions)[number]>();
    for (const version of versions)
      if (!latest.has(version.parameterCode))
        latest.set(version.parameterCode, version);
    // Stored plans are re-validated at load: a plan that predates stricter
    // validation is skipped instead of aborting the whole ruleset.
    const rules: ApprovedRule[] = [];
    for (const version of latest.values()) {
      try {
        rules.push({
          parameter_code: version.parameterCode,
          rule_version_id: version.id,
          version: version.version,
          plan: validateExtractionPlan(version.plan),
          comparison:
            version.comparison === null
              ? null
              : validateComparisonSpec(version.comparison),
        });
      } catch {
        continue;
      }
    }
    return rules;
  }

  // Object -> process is the same lock order as ingestion/parsing/classification.
  // Recheck after locking so a concurrent new Run/reparse cannot publish stale evidence.
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

  async enqueue(tx: Prisma.TransactionClient, task: ExtractionTask) {
    await tx.outbox.create({
      data: {
        eventType: "extraction.requested",
        availableAt: task.availableAt,
        payload: {
          schema_version: 1,
          event_type: "extraction.requested",
          task_id: task.id,
        },
      },
    });
    await tx.extractionTask.update({
      where: { id: task.id },
      data: { dispatchedAt: new Date() },
    });
  }

  // A changed approved ruleset (new/approved/deprecated rule version) changes
  // the fingerprint and starts a new cycle for every current artifact.
  async recover() {
    const rules = await this.approvedRules();
    const fingerprint = rulesetFingerprint(rules);
    if (rules.length > 0) {
      const missing = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT a.id FROM parse_artifacts a
        JOIN parsing_tasks t ON t.id=a.task_id JOIN runs r ON r.id=t.run_id
        JOIN processes p ON p.id=t.process_id JOIN files f ON f.id=t.file_id
        LEFT JOIN LATERAL (SELECT fingerprint FROM extraction_tasks e WHERE e.artifact_id=a.id ORDER BY cycle DESC LIMIT 1) e ON true
        WHERE t.state='succeeded' AND r.version=p.version AND p.status IN ('PENDING','PARSING','READY','VERIFYING')
          AND f.corrupted_at IS NULL AND a.source_sha256=f.sha256
          AND NOT EXISTS (SELECT 1 FROM parsing_tasks newer WHERE newer.run_id=t.run_id AND newer.file_id=t.file_id AND newer.cycle>t.cycle)
          AND (
            e.fingerprint IS NULL OR e.fingerprint <> ${fingerprint}
            OR EXISTS (
              SELECT 1 FROM extraction_tasks lt
              JOIN extractions x ON x.task_id = lt.id
              JOIN LATERAL (
                SELECT c.result->>'stage' AS stage
                FROM classification_tasks c
                WHERE c.artifact_id = a.id AND c.state = 'succeeded'
                ORDER BY c.cycle DESC LIMIT 1
              ) cls ON true
              WHERE lt.artifact_id = a.id
                AND lt.state = 'succeeded'
                AND lt.cycle = (
                  SELECT MAX(prev.cycle) FROM extraction_tasks prev
                  WHERE prev.artifact_id = a.id AND prev.state = 'succeeded'
                )
                AND cls.stage IS DISTINCT FROM x.stage
            )
          )
        ORDER BY a.created_at LIMIT 25`;
      for (const { id } of missing) {
        await this.prisma.$transaction(async (tx) => {
          const context = await this.current(tx, id);
          if (!context || !ACTIVE_STATUSES.includes(context.process.status))
            return;
          const previous = await tx.extractionTask.findFirst({
            where: { artifactId: id },
            orderBy: { cycle: "desc" },
          });
          // An in-flight cycle with the current fingerprint already reads the
          // fresh stage at persist time; only a finished divergent one needs
          // a follow-up cycle.
          if (previous?.fingerprint === fingerprint) {
            const terminal =
              previous.state === "succeeded" || previous.state === "failed";
            if (!terminal || !(await this.stageDiverged(tx, id))) return;
          }
          const next = await tx.extractionTask.create({
            data: {
              artifactId: id,
              cycle: (previous?.cycle ?? 0) + 1,
              fingerprint,
            },
          });
          await this.enqueue(tx, next);
        });
      }
    }
    const expired = await this.prisma.extractionTask.findMany({
      where: {
        state: "processing",
        leaseUntil: { lt: new Date() },
      },
      take: 25,
    });
    for (const task of expired)
      await this.failure(task, "extraction_lease_expired", true, true);
    const queued = await this.prisma.extractionTask.findMany({
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
    for (const item of queued) {
      await this.prisma.$transaction(async (tx) => {
        const context = await this.current(tx, item.artifactId);
        const task = await tx.extractionTask.findUniqueOrThrow({
          where: { id: item.id },
        });
        const latest = await tx.extractionTask.findFirst({
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
          task.fingerprint !==
            rulesetFingerprint(await this.approvedRules(tx)) ||
          !ACTIVE_STATUSES.includes(context.process.status)
        ) {
          await tx.extractionTask.update({
            where: { id: task.id },
            data: {
              state: "failed",
              errorCode: "extraction_superseded",
              completedAt: new Date(),
            },
          });
          return;
        }
        await this.enqueue(tx, task);
      });
    }
  }

  private async artifactStage(
    tx: Prisma.TransactionClient,
    artifactId: string,
  ): Promise<string | null> {
    const classified = await tx.classificationTask.findFirst({
      where: { artifactId, state: "succeeded" },
      orderBy: { cycle: "desc" },
    });
    const result = classified?.result as ClassificationResult | null;
    return result?.stage ?? null;
  }

  // Classification may land after extraction; the stored stage snapshot then
  // diverges from the terminal classification and a fresh cycle re-aligns it.
  private async stageDiverged(
    tx: Prisma.TransactionClient,
    artifactId: string,
  ): Promise<boolean> {
    const latest = await tx.extractionTask.findFirst({
      where: { artifactId, state: "succeeded" },
      orderBy: { cycle: "desc" },
      include: { extractions: { take: 1, select: { stage: true } } },
    });
    if (!latest || latest.extractions.length === 0) return false;
    return (
      latest.extractions[0]!.stage !==
      (await this.artifactStage(tx, artifactId))
    );
  }

  async execute(taskId: string, signal?: AbortSignal) {
    if (signal?.aborted) return;
    const claimed = await this.prisma.$transaction(async (tx) => {
      const initial = await tx.extractionTask.findUnique({
        where: { id: taskId },
      });
      if (!initial) return null;
      const context = await this.current(tx, initial.artifactId);
      const task = await tx.extractionTask.findUniqueOrThrow({
        where: { id: taskId },
      });
      if (task.state !== "queued" || task.availableAt.getTime() > Date.now())
        return null;
      const latest = await tx.extractionTask.findFirst({
        where: { artifactId: task.artifactId },
        orderBy: { cycle: "desc" },
      });
      const rules = await this.approvedRules(tx);
      if (
        !context ||
        latest?.id !== task.id ||
        task.fingerprint !== rulesetFingerprint(rules) ||
        !ACTIVE_STATUSES.includes(context.process.status)
      ) {
        await tx.extractionTask.update({
          where: { id: taskId },
          data: {
            state: "failed",
            errorCode: "extraction_superseded",
            completedAt: new Date(),
          },
        });
        return null;
      }
      const owned = await tx.extractionTask.update({
        where: { id: task.id },
        data: {
          state: "processing",
          attempts: { increment: 1 },
          leaseToken: randomUUID(),
          leaseUntil: new Date(Date.now() + LEASE_MS),
          errorCode: null,
        },
      });
      return { owned, context, rules };
    });
    if (!claimed) return;
    const { owned, context, rules } = claimed;
    let outcomes: ExtractionOutcome[];
    try {
      const artifact = await this.artifacts.read(
        context.artifact.storageKey,
        context.artifact.artifactSha256,
        context.file.sha256,
        context.artifact.pipelineFingerprint,
        "stored",
      );
      outcomes = executeArtifact(artifact, rules);
      if (signal?.aborted) throw new ExtractionInterrupted();
    } catch (error) {
      await this.failure(
        owned,
        error instanceof ExtractionInterrupted
          ? "extraction_interrupted"
          : "extraction_artifact_unavailable",
        error instanceof ExtractionInterrupted,
      );
      return;
    }
    // Infrastructure failures must escape to broker/lease recovery rather than
    // being recorded as a permanent artifact/ruleset error.
    await this.prisma.$transaction(async (tx) => {
      const current = await this.current(tx, owned.artifactId);
      const task = await tx.extractionTask.findUniqueOrThrow({
        where: { id: owned.id },
      });
      const latest = await tx.extractionTask.findFirst({
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
        !ACTIVE_STATUSES.includes(current.process.status)
      ) {
        await tx.extractionTask.update({
          where: { id: owned.id },
          data: {
            state: "failed",
            leaseToken: null,
            leaseUntil: null,
            errorCode: "extraction_superseded",
            completedAt: new Date(),
          },
        });
        return;
      }
      const stage = await this.artifactStage(tx, owned.artifactId);
      for (const outcome of outcomes) {
        const extraction = await tx.extraction.create({
          data: {
            taskId: owned.id,
            artifactId: owned.artifactId,
            fileId: context.file.id,
            objectId: context.task.objectId,
            processId: context.task.processId,
            runId: context.task.runId,
            parameterCode: outcome.parameter_code,
            ruleVersionId: outcome.rule_version_id,
            status: outcome.status,
            stage,
            valueRaw: outcome.value_raw,
            value:
              outcome.value === null
                ? undefined
                : (JSON.parse(
                    JSON.stringify(outcome.value),
                  ) as Prisma.InputJsonValue),
            unit: outcome.unit,
            alternatives:
              outcome.alternatives === null
                ? undefined
                : (JSON.parse(
                    JSON.stringify(outcome.alternatives),
                  ) as Prisma.InputJsonValue),
            reason: outcome.reason,
          },
        });
        for (const locator of outcome.evidence) {
          await tx.evidenceFragment.create({
            data: {
              extractionId: extraction.id,
              fileId: context.file.id,
              artifactId: owned.artifactId,
              pageNumber: locator.page_number,
              sheetLabel: locator.sheet_label,
              blockId: locator.block_id,
              tableId: locator.table_id,
              tableRow: locator.table_row,
              tableColumn: locator.table_column,
              quote: locator.quote,
              bbox:
                locator.bbox === null
                  ? undefined
                  : (JSON.parse(
                      JSON.stringify(locator.bbox),
                    ) as Prisma.InputJsonValue),
              structuralPath: locator.structural_path,
            },
          });
        }
      }
      await tx.extractionTask.update({
        where: { id: owned.id },
        data: {
          state: "succeeded",
          completedAt: new Date(),
          leaseToken: null,
          leaseUntil: null,
        },
      });
      await this.rebuildGroups(tx, {
        objectId: context.task.objectId,
        processId: context.task.processId,
        rulesetHash: owned.fingerprint,
        parameterCodes: [
          ...new Set(outcomes.map((item) => item.parameter_code)),
        ],
        rules,
      });
      await tx.outbox.create({
        data: {
          eventType: "extraction.succeeded",
          payload: {
            schema_version: 1,
            task_id: owned.id,
            artifact_id: owned.artifactId,
            file_id: context.file.id,
            run_id: context.task.runId,
            object_id: context.task.objectId,
            ruleset_fingerprint: owned.fingerprint,
          },
        },
      });
    });
  }

  /**
   * Evidence groups for the touched parameters: expected members come from
   * PD-stage files, actual from RD/ID, unknown stage stays explicit. Members
   * reference Extraction rows; only latest succeeded cycles contribute.
   */
  private async rebuildGroups(
    tx: Prisma.TransactionClient,
    scope: {
      objectId: string;
      processId: string;
      rulesetHash: string;
      parameterCodes: string[];
      rules: ApprovedRule[];
    },
  ) {
    for (const parameterCode of scope.parameterCodes) {
      const rows = await tx.$queryRaw<
        {
          id: string;
          file_id: string;
          artifact_id: string;
          stage: string | null;
          status: string;
          value: unknown;
          value_raw: string | null;
          unit: string | null;
          rule_version_id: string;
        }[]
      >`
        SELECT e.id, e.file_id, e.artifact_id, e.stage, e.status, e.value,
               e.value_raw, e.unit, e.rule_version_id
        FROM extractions e
        JOIN extraction_tasks t ON t.id = e.task_id
        JOIN LATERAL (
          SELECT id FROM extraction_tasks newer
          WHERE newer.artifact_id = t.artifact_id AND newer.state = 'succeeded'
          ORDER BY newer.cycle DESC LIMIT 1
        ) latest ON latest.id = t.id
        WHERE e.object_id = ${scope.objectId}::uuid
          AND e.process_id = ${scope.processId}::uuid
          AND e.parameter_code = ${parameterCode}
          AND t.fingerprint = ${scope.rulesetHash}`;
      const members = rows.map((row) => ({
        extraction_id: row.id,
        file_id: row.file_id,
        artifact_id: row.artifact_id,
        stage: row.stage,
        role:
          row.stage === "PD"
            ? ("expected" as const)
            : row.stage === null
              ? ("unknown" as const)
              : ("actual" as const),
        status: row.status,
        value: row.value as number | string | null,
        value_raw: row.value_raw,
        unit: row.unit,
        rule_version_id: row.rule_version_id,
      }));
      const rule = scope.rules.find(
        (item) => item.parameter_code === parameterCode,
      );
      const verdict = evaluateGroup(members, rule?.comparison ?? null);
      const verdictJson = JSON.parse(
        JSON.stringify(verdict),
      ) as Prisma.InputJsonValue;
      await tx.evidenceGroup.upsert({
        where: {
          objectId_processId_parameterCode_scopeKey: {
            objectId: scope.objectId,
            processId: scope.processId,
            parameterCode,
            scopeKey: "",
          },
        },
        create: {
          objectId: scope.objectId,
          processId: scope.processId,
          parameterCode,
          scopeKey: "",
          rulesetHash: scope.rulesetHash,
          members: JSON.parse(JSON.stringify(members)) as Prisma.InputJsonValue,
          verdict: verdictJson,
        },
        update: {
          rulesetHash: scope.rulesetHash,
          members: JSON.parse(JSON.stringify(members)) as Prisma.InputJsonValue,
          verdict: verdictJson,
        },
      });
    }
  }

  private async failure(
    owned: ExtractionTask,
    code: string,
    retryable: boolean,
    expired = false,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const context = await this.current(tx, owned.artifactId);
      const task = await tx.extractionTask.findUniqueOrThrow({
        where: { id: owned.id },
      });
      const latest = await tx.extractionTask.findFirst({
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
        ACTIVE_STATUSES.includes(context.process.status),
      );
      const retry = valid && retryable && task.attempts < 3;
      const next = await tx.extractionTask.update({
        where: { id: task.id },
        data: {
          state: retry ? "queued" : "failed",
          errorCode: valid ? code : "extraction_superseded",
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
            eventType: "extraction.failed",
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

class ExtractionInterrupted extends Error {}
