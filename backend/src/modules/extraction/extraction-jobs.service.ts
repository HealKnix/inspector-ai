import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { ExtractionTask, Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import type { IdentificationSnapshot } from "../identification/identification-contract.js";
import { identificationSources } from "../identification/identification-state.js";
import { ObjectAccessService } from "../objects/object-access.service.js";
import { ArtifactStorageService } from "../parsing/artifact-storage.service.js";
import { validateComparisonSpec } from "./comparison-contract.js";
import {
  validateExtractionPlan,
  type ExtractionOutcome,
} from "./extraction-contract.js";
import {
  executeArtifact,
  rulesetFingerprint,
  type ApprovedRule,
} from "./extraction-engine.js";
import {
  identifiedGroups,
  type IdentifiedExtraction,
} from "./identified-groups.js";

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
    const snapshot = await tx.resolvedInputSnapshot.findFirst({
      where: { runId: task.runId },
      orderBy: { version: "desc" },
    });
    if (snapshot) {
      const sources = await identificationSources(tx, task.runId);
      if (!sources.ready || sources.fingerprint !== snapshot.sourceFingerprint)
        return null;
    }
    return { artifact, task, file, process, snapshot };
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
        JOIN LATERAL (SELECT resolved_input_hash FROM resolved_input_snapshots s WHERE s.run_id=r.id ORDER BY version DESC LIMIT 1) s ON true
        LEFT JOIN LATERAL (SELECT fingerprint,resolved_input_hash FROM extraction_tasks e WHERE e.artifact_id=a.id ORDER BY cycle DESC LIMIT 1) e ON true
        WHERE t.state='succeeded' AND r.version=p.version AND p.status IN ('PENDING','PARSING','READY','VERIFYING')
          AND f.corrupted_at IS NULL AND a.source_sha256=f.sha256
          AND NOT EXISTS (SELECT 1 FROM parsing_tasks newer WHERE newer.run_id=t.run_id AND newer.file_id=t.file_id AND newer.cycle>t.cycle)
          AND (
            e.fingerprint IS NULL OR e.fingerprint <> ${fingerprint} OR e.resolved_input_hash IS DISTINCT FROM s.resolved_input_hash
          )
        ORDER BY a.created_at LIMIT 25`;
      for (const { id } of missing) {
        await this.prisma.$transaction(async (tx) => {
          const context = await this.current(tx, id);
          if (
            !context?.snapshot ||
            !ACTIVE_STATUSES.includes(context.process.status)
          )
            return;
          const previous = await tx.extractionTask.findFirst({
            where: { artifactId: id },
            orderBy: { cycle: "desc" },
          });
          // An in-flight cycle with the current fingerprint already reads the
          // fresh stage at persist time; only a finished divergent one needs
          // a follow-up cycle.
          if (
            previous?.fingerprint === fingerprint &&
            previous.resolvedInputHash === context.snapshot.resolvedInputHash
          ) {
            const terminal =
              previous.state === "succeeded" || previous.state === "failed";
            if (!terminal || !(await this.stageDiverged(tx, id))) return;
          }
          const next = await tx.extractionTask.create({
            data: {
              artifactId: id,
              cycle: (previous?.cycle ?? 0) + 1,
              fingerprint,
              resolvedInputHash: context.snapshot.resolvedInputHash,
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
          task.resolvedInputHash !== context.snapshot?.resolvedInputHash ||
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
    const artifact = await tx.parseArtifact.findUnique({
      where: { id: artifactId },
      include: { task: true },
    });
    const snapshot = artifact
      ? await tx.resolvedInputSnapshot.findFirst({
          where: { runId: artifact.task.runId },
          orderBy: { version: "desc" },
        })
      : null;
    const data = snapshot?.snapshot as unknown as
      IdentificationSnapshot | undefined;
    return (
      data?.documents
        .flatMap((doc) => doc.revisions)
        .find((rev) =>
          rev.representations.some((rep) => rep.artifact_id === artifactId),
        )?.fields.stage ?? null
    );
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
        task.resolvedInputHash !== context.snapshot?.resolvedInputHash ||
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
        task.resolvedInputHash !== current.snapshot?.resolvedInputHash ||
        task.fingerprint !== rulesetFingerprint(await this.approvedRules(tx)) ||
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
        runId: context.task.runId,
        resolvedInputHash: owned.resolvedInputHash!,
        snapshot: current.snapshot
          .snapshot as unknown as IdentificationSnapshot,
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
      runId: string;
      resolvedInputHash: string;
      snapshot: IdentificationSnapshot;
      rulesetHash: string;
      parameterCodes: string[];
      rules: ApprovedRule[];
    },
  ) {
    const matrix = await tx.matrixImport.findFirst({
      orderBy: { importedAt: "desc" },
    });
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
          AND e.run_id = ${scope.runId}::uuid
          AND e.parameter_code = ${parameterCode}
          AND t.resolved_input_hash = ${scope.resolvedInputHash}
          AND t.fingerprint = ${scope.rulesetHash}`;
      const fragments = await tx.evidenceFragment.findMany({
        where: { extractionId: { in: rows.map((row) => row.id) } },
        select: {
          extractionId: true,
          fileId: true,
          artifactId: true,
          pageNumber: true,
          sheetLabel: true,
          blockId: true,
          tableId: true,
          tableRow: true,
          tableColumn: true,
          quote: true,
          bbox: true,
          structuralPath: true,
        },
      });
      const members: IdentifiedExtraction[] = rows.map((row) => ({
        extraction_id: row.id,
        file_id: row.file_id,
        artifact_id: row.artifact_id,
        stage: row.stage,
        role: "unknown",
        status: row.status,
        value: row.value as number | string | null,
        value_raw: row.value_raw,
        unit: row.unit,
        rule_version_id: row.rule_version_id,
        evidence: fragments.filter(
          (fragment) => fragment.extractionId === row.id,
        ),
      }));
      const rule = scope.rules.find(
        (item) => item.parameter_code === parameterCode,
      );
      const row = matrix
        ? await tx.matrixRow.findFirst({
            where: { importId: matrix.id, parameterCode },
          })
        : null;
      const allowedStages = (
        [
          ["PD", row?.sourcePd],
          ["RD", row?.sourceRd],
          ["ID", row?.sourceId],
        ] as const
      )
        .filter(([, source]) => Boolean(source))
        .map(([stage]) => stage);
      for (const group of identifiedGroups(
        scope.snapshot,
        members,
        rule?.comparison ?? null,
        allowedStages,
      )) {
        // Append-only versions. The object lock serializes concurrent completions.
        const exists = await tx.evidenceGroup.findFirst({
          where: {
            runId: scope.runId,
            resolvedInputHash: scope.resolvedInputHash,
            parameterCode,
            contextKey: group.contextKey,
            contentHash: group.contentHash,
          },
        });
        if (exists) continue;
        const previous = await tx.evidenceGroup.findFirst({
          where: {
            runId: scope.runId,
            resolvedInputHash: scope.resolvedInputHash,
            parameterCode,
            contextKey: group.contextKey,
          },
          orderBy: { version: "desc" },
        });
        await tx.evidenceGroup.create({
          data: {
            version: (previous?.version ?? 0) + 1,
            objectId: scope.objectId,
            processId: scope.processId,
            runId: scope.runId,
            resolvedInputHash: scope.resolvedInputHash,
            parameterCode,
            scopeKey: group.scopeKey,
            contextKey: group.contextKey,
            contentHash: group.contentHash,
            rulesetHash: scope.rulesetHash,
            members: JSON.parse(
              JSON.stringify(group.members),
            ) as Prisma.InputJsonValue,
            verdict: JSON.parse(
              JSON.stringify(group.verdict),
            ) as Prisma.InputJsonValue,
          },
        });
      }
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
