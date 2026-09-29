import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";
import type {
  Prisma,
  SectionAnalysisTask,
} from "../../generated/prisma/client.js";
import { writeOutboxEvent } from "../../infrastructure/observability/trace-context.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { canonicalJson } from "../documents/canonical-json.js";
import type { IdentificationSnapshot } from "../identification/identification-contract.js";
import {
  identificationSources,
  type IdentificationSources,
} from "../identification/identification-state.js";
import { ObjectAccessService } from "../objects/object-access.service.js";
import { ArtifactStorageService } from "../parsing/artifact-storage.service.js";
import type { ParseArtifactData } from "../parsing/parsing-contract.js";
import type { ReleaseManifest } from "./rule-set-release.js";
import {
  readSectionAnalysisConfig,
  type SectionAnalysisConfig,
} from "./section-config.js";
import {
  SECTION_ANALYSIS_PROMPT_VERSION,
  SECTION_DISCOVERY_PROMPT_VERSION,
  SECTION_ENGINE_VERSION,
  SectionAnalysisError,
  type SectionAnalysisOutput,
  type SectionMatrixRow,
} from "./section-contract.js";
import {
  runSectionAnalysis,
  type SectionIndexCache,
  type SectionIndexCacheEntry,
  type SectionLlm,
} from "./section-engine.js";
import { callSectionLlm } from "./section-llm.js";

/**
 * Server side of the section-first analysis lifecycle. This module owns only
 * durable orchestration: admission state, leases, fencing and publication.
 * All semantic work (retrieval, discovery, provider calls, validation) lives
 * behind SectionAnalysisExecutor in the pure section-* core.
 */

/** Everything the executor needs; contains no provider configuration. */
export interface SectionAnalysisWork {
  task_id: string;
  run_id: string;
  process_id: string;
  object_id: string;
  resolved_input_hash: string;
  source_fingerprint: string;
  matrix_import_id: string;
  /** Content identity of the pinned import (matrix_imports.source_sha256). */
  matrix_sha256: string;
  snapshot: IdentificationSnapshot;
  matrix_rows: SectionMatrixRow[];
  /** Pinned artifact ids from the admission-time provenance manifest. */
  artifact_ids: string[];
  /** Integrity-checked storage read; null when the artifact is unavailable. */
  readArtifact(artifact_id: string): Promise<ParseArtifactData | null>;
  /** Durable semantic boundary cache (section_index_cache). */
  index: SectionIndexCache;
  /** Renews the lease; false means the worker lost ownership and must stop. */
  heartbeat(): Promise<boolean>;
}

export interface SectionAnalysisExecutor {
  /** False when SECTION_LLM_ENABLED is off; admission is refused then. */
  readonly enabled: boolean;
  /** sha256 over model/prompt/engine/budget configuration (no secrets). */
  readonly configFingerprint: string;
  execute(
    work: SectionAnalysisWork,
    signal?: AbortSignal,
  ): Promise<SectionAnalysisOutput>;
}

export const SECTION_ANALYSIS_EXECUTOR = "SECTION_ANALYSIS_EXECUTOR";

export const disabledSectionExecutor: SectionAnalysisExecutor = {
  enabled: false,
  configFingerprint: "0".repeat(64),
  execute() {
    return Promise.reject(
      new SectionAnalysisError("section_engine_unavailable", false),
    );
  },
};

/**
 * Thin adapter between the durable work record and the pure engine. Artifact
 * views are loaded eagerly because the engine resolves sources synchronously;
 * a total storage outage is a retryable task failure, while individual
 * missing artifacts stay honest per-context missing coverage.
 */
export function createSectionExecutor(
  config: SectionAnalysisConfig,
): SectionAnalysisExecutor {
  const configFingerprint = createHash("sha256")
    .update(
      canonicalJson({
        engine: SECTION_ENGINE_VERSION,
        discovery_prompt: SECTION_DISCOVERY_PROMPT_VERSION,
        analysis_prompt: SECTION_ANALYSIS_PROMPT_VERSION,
        model: config.model,
        // Nonsecret provider identity: a different endpoint, strict-schema
        // mode or timeout changes the semantic basis even under one model.
        provider: {
          base_url: config.baseUrl,
          require_parameters: config.requireParameters,
          timeout_ms: config.timeoutMs,
        },
        bounds: {
          max_candidate_bytes: config.maxCandidateBytes,
          max_chunk_bytes: config.maxChunkBytes,
          max_block_characters: config.maxBlockCharacters,
          max_parameters_per_request: config.maxParametersPerRequest,
          max_calls: config.maxCalls,
          max_expansion_candidates: config.maxExpansionCandidates,
          max_request_bytes: config.maxRequestBytes,
          max_response_bytes: config.maxResponseBytes,
        },
      }),
    )
    .digest("hex");
  return {
    enabled: config.enabled,
    configFingerprint,
    async execute(work, signal) {
      const loaded = new Map<string, ParseArtifactData>();
      let unavailable = 0;
      for (const artifactId of work.artifact_ids) {
        if (signal?.aborted)
          throw new SectionAnalysisError("section_interrupted", true);
        if (!(await work.heartbeat()))
          throw new SectionAnalysisError("section_lease_lost", true);
        const artifact = await work.readArtifact(artifactId);
        if (artifact) loaded.set(artifactId, artifact);
        else unavailable++;
      }
      if (work.artifact_ids.length && unavailable === work.artifact_ids.length)
        throw new SectionAnalysisError("section_artifact_unavailable", true);
      const llm: SectionLlm = {
        call: (kind, payload) =>
          callSectionLlm(config, kind, payload, { signal }),
      };
      return runSectionAnalysis({
        snapshot: work.snapshot,
        artifactFor: (artifactId) => loaded.get(artifactId) ?? null,
        rows: work.matrix_rows,
        matrix_identity: work.matrix_sha256,
        config,
        llm,
        cache: work.index,
      });
    },
  };
}

// Provider calls are slower than CPU extraction, so the lease is renewable:
// heartbeats every HEARTBEAT_MS extend it, and a hard runtime bound stops a
// wedged call deterministically.
const LEASE_MS = 120_000;
const HEARTBEAT_MS = 30_000;
// Discovery on a CPU-hosted small model takes ~20 minutes for a mid-size
// manifest before any analysis call runs; the bound still stops wedged work
// deterministically but must cover the documented offline profile.
const MAX_RUNTIME_MS = 60 * 60_000;
const ACTIVE_STATUSES = ["PENDING", "PARSING", "READY", "VERIFYING"];
const REDISPATCH_AFTER_MS = 60_000;
// Engine failures that are legitimate bounded domain outcomes, not technical
// faults: they stay on the success path with their partial coverage intact.
const DOMAIN_FAILURE_CODES = new Set(["section_call_budget_exhausted"]);

type Basis = {
  run: {
    id: string;
    objectId: string;
    processId: string;
    version: number;
    process: { version: number; status: string };
    ruleSetRelease: { manifest: Prisma.JsonValue } | null;
  };
  source: IdentificationSources;
};

@Injectable()
export class SectionAnalysisJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ObjectAccessService,
    private readonly artifacts: ArtifactStorageService,
    @Inject(SECTION_ANALYSIS_EXECUTOR)
    private readonly executor: SectionAnalysisExecutor,
  ) {}

  /** Executor-facing configuration facts; no secrets ever leave through it. */
  executorState() {
    return {
      enabled: this.executor.enabled,
      configFingerprint: this.executor.enabled
        ? this.executor.configFingerprint
        : null,
    };
  }

  /**
   * Object -> process lock order, same as ingestion/parsing/extraction.
   * Returns null when the run is missing, not current or the process is no
   * longer an active analysis scope. Every mutable-state inspection happens
   * only after this lock.
   */
  private async lockedBasis(
    tx: Prisma.TransactionClient,
    runId: string,
  ): Promise<Basis | null> {
    const ids = await tx.run.findUnique({
      where: { id: runId },
      select: { objectId: true, processId: true },
    });
    if (!ids) return null;
    await this.access.lock(tx, ids.objectId);
    await tx.$queryRaw`SELECT id FROM processes WHERE id=${ids.processId}::uuid FOR UPDATE`;
    // Only post-lock state is fenced truth: finalization or a run swap that
    // committed while this transaction waited must invalidate the basis.
    const run = await tx.run.findUnique({
      where: { id: runId },
      include: { process: true, ruleSetRelease: true },
    });
    if (!run) return null;
    const source = await identificationSources(tx, runId);
    if (
      run.version !== run.process.version ||
      !ACTIVE_STATUSES.includes(run.process.status)
    )
      return null;
    return { run, source };
  }

  /**
   * Everything that makes a task still publishable under the caller's lock:
   * sources still resolved to the same fingerprints, latest resolved
   * snapshot, same pinned matrix import and same engine configuration; the
   * task is still the newest cycle of its semantic fingerprint.
   */
  private async basisHolds(
    tx: Prisma.TransactionClient,
    basis: Basis,
    task: Pick<
      SectionAnalysisTask,
      | "id"
      | "runId"
      | "fingerprint"
      | "resolvedInputHash"
      | "sourceFingerprint"
      | "matrixImportId"
      | "configFingerprint"
    >,
  ): Promise<boolean> {
    if (!this.executor.enabled) return false;
    if (!basis.source.ready) return false;
    if (basis.source.fingerprint !== task.sourceFingerprint) return false;
    const snapshot = await tx.resolvedInputSnapshot.findFirst({
      where: { runId: task.runId },
      orderBy: { version: "desc" },
    });
    if (snapshot?.resolvedInputHash !== task.resolvedInputHash) return false;
    if (
      (await selectedMatrixImportId(tx, basis.run)) !== task.matrixImportId ||
      task.configFingerprint !== this.executor.configFingerprint
    )
      return false;
    const latest = await tx.sectionAnalysisTask.findFirst({
      where: { runId: task.runId, fingerprint: task.fingerprint },
      orderBy: { cycle: "desc" },
    });
    return latest?.id === task.id;
  }

  /**
   * Read-side variant for status/verification: evaluates the same basis
   * against the caller's already-locked transaction. Run currency itself is
   * reported separately by callers.
   */
  async taskBasisHolds(
    tx: Prisma.TransactionClient,
    task: Pick<
      SectionAnalysisTask,
      | "id"
      | "runId"
      | "fingerprint"
      | "resolvedInputHash"
      | "sourceFingerprint"
      | "matrixImportId"
      | "configFingerprint"
    >,
  ): Promise<boolean> {
    const run = await tx.run.findUnique({
      where: { id: task.runId },
      include: { process: true, ruleSetRelease: true },
    });
    if (!run) return false;
    const source = await identificationSources(tx, task.runId);
    return this.basisHolds(tx, { run, source }, task);
  }

  /**
   * Admit a new cycle inside the caller's transaction and dispatch it through
   * the outbox. Called by the admission path only; recovery never creates.
   */
  async createTask(
    tx: Prisma.TransactionClient,
    data: Omit<
      Prisma.SectionAnalysisTaskUncheckedCreateInput,
      | "id"
      | "state"
      | "attempts"
      | "availableAt"
      | "dispatchedAt"
      | "leaseUntil"
      | "leaseToken"
      | "errorCode"
      | "result"
      | "createdAt"
      | "completedAt"
    >,
  ): Promise<SectionAnalysisTask> {
    const task = await tx.sectionAnalysisTask.create({ data });
    await this.enqueue(tx, task);
    return task;
  }

  async enqueue(tx: Prisma.TransactionClient, task: SectionAnalysisTask) {
    await writeOutboxEvent(tx, {
      data: {
        eventType: "section_analysis.requested",
        availableAt: task.availableAt,
        payload: {
          schema_version: 1,
          event_type: "section_analysis.requested",
          task_id: task.id,
        },
      },
    });
    await tx.sectionAnalysisTask.update({
      where: { id: task.id },
      data: { dispatchedAt: new Date() },
    });
  }

  /**
   * Bounded recovery: expired leases become retryable failures (rechecked
   * under the ownership lock so a live heartbeat never loses its claim) and
   * lost dispatches are re-enqueued. Section tasks are admitted explicitly,
   * so a missing task is never recreated here.
   */
  async recover() {
    const expired = await this.prisma.sectionAnalysisTask.findMany({
      where: { state: "processing", leaseUntil: { lt: new Date() } },
      take: 25,
    });
    for (const task of expired)
      await this.failure(task, "section_lease_expired", {
        retryable: true,
        requireExpiredLease: true,
      });
    const queued = await this.prisma.sectionAnalysisTask.findMany({
      where: {
        state: "queued",
        availableAt: { lte: new Date() },
        OR: [
          { dispatchedAt: null },
          { dispatchedAt: { lt: new Date(Date.now() - REDISPATCH_AFTER_MS) } },
        ],
      },
      take: 25,
    });
    for (const item of queued) {
      await this.prisma.$transaction(async (tx) => {
        const basis = await this.lockedBasis(tx, item.runId);
        const task = await tx.sectionAnalysisTask.findUniqueOrThrow({
          where: { id: item.id },
        });
        if (
          task.state !== "queued" ||
          (task.dispatchedAt &&
            task.dispatchedAt.getTime() > Date.now() - REDISPATCH_AFTER_MS)
        )
          return;
        if (!basis || !(await this.basisHolds(tx, basis, task))) {
          await this.failInTx(tx, task, "section_superseded");
          return;
        }
        await this.enqueue(tx, task);
      });
    }
  }

  async execute(taskId: string, signal?: AbortSignal) {
    if (signal?.aborted) return;
    // Locks first: mutable ownership fields are only re-read and mutated under
    // the object/process lock, so duplicate deliveries serialize instead of
    // both seeing "queued".
    const claimed = await this.prisma.$transaction(
      async (tx) => {
        const initial = await tx.sectionAnalysisTask.findUnique({
          where: { id: taskId },
        });
        if (!initial) return null;
        const basis = await this.lockedBasis(tx, initial.runId);
        const task = await tx.sectionAnalysisTask.findUniqueOrThrow({
          where: { id: taskId },
        });
        if (task.state !== "queued" || task.availableAt.getTime() > Date.now())
          return null;
        if (!basis || !(await this.basisHolds(tx, basis, task))) {
          await this.failInTx(tx, task, "section_superseded");
          return null;
        }
        const leaseToken = randomUUID();
        const leaseUntil = new Date(Date.now() + LEASE_MS);
        const claim = await tx.sectionAnalysisTask.updateMany({
          where: { id: task.id, state: "queued" },
          data: {
            state: "processing",
            attempts: { increment: 1 },
            leaseToken,
            leaseUntil,
            errorCode: null,
          },
        });
        if (!claim.count) return null;
        const owned: SectionAnalysisTask = {
          ...task,
          state: "processing",
          attempts: task.attempts + 1,
          leaseToken,
          leaseUntil,
          errorCode: null,
        };
        const snapshot = await tx.resolvedInputSnapshot.findUniqueOrThrow({
          where: {
            runId_resolvedInputHash: {
              runId: task.runId,
              resolvedInputHash: task.resolvedInputHash,
            },
          },
        });
        const artifactIds = manifestArtifactIds(task.sourceManifest);
        const records = artifactIds.length
          ? await tx.parseArtifact.findMany({
              where: { id: { in: artifactIds } },
              include: { task: { include: { file: true } } },
            })
          : [];
        return { owned, snapshot, artifactIds, records };
      },
      { timeout: 20_000 },
    );
    if (!claimed) return;
    const { owned, snapshot, artifactIds, records } = claimed;
    const artifactIndex = new Map(
      records.map((record) => [
        record.id,
        {
          storageKey: record.storageKey,
          artifactSha256: record.artifactSha256,
          sourceSha256: record.task.file.sha256,
          pipelineFingerprint: record.pipelineFingerprint,
        },
      ]),
    );
    const renew = async () => {
      try {
        return Boolean(
          (
            await this.prisma.sectionAnalysisTask.updateMany({
              where: {
                id: owned.id,
                state: "processing",
                leaseToken: owned.leaseToken,
                leaseUntil: { gt: new Date() },
              },
              data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
            })
          ).count,
        );
      } catch {
        // A failed renewal must not surface as an unhandled rejection; a
        // lost lease aborts the work and durable recovery decides the rest.
        return false;
      }
    };
    // A lost lease (superseded task, expired claim, dead database link) aborts
    // provider work; the external worker stop signal and a hard bound do too.
    // The listener stays registered until the fenced write completes so an
    // abort during the publication lock wait is still observed.
    const inner = new AbortController();
    const stop = () => inner.abort();
    signal?.addEventListener("abort", stop);
    // The signal may already be latched by an abort that landed while the
    // claim transaction waited on locks.
    if (signal?.aborted) inner.abort();
    const hardBound = setTimeout(() => inner.abort(), MAX_RUNTIME_MS);
    const heartbeat = setInterval(() => {
      void renew().then((ok) => {
        if (!ok) inner.abort();
      });
    }, HEARTBEAT_MS);
    try {
      const index: SectionIndexCache = {
        get: async (key) =>
          (
            await this.prisma.sectionIndexCache.findUnique({
              where: { fingerprint: key },
              select: { boundaries: true },
            })
          )?.boundaries as SectionIndexCacheEntry | undefined,
        set: async (key, entry) => {
          await this.prisma.sectionIndexCache.upsert({
            where: { fingerprint: key },
            update: {},
            create: {
              fingerprint: key,
              boundaries: JSON.parse(
                JSON.stringify(entry),
              ) as Prisma.InputJsonValue,
            },
          });
        },
      };
      let output: SectionAnalysisOutput;
      try {
        if (inner.signal.aborted)
          throw new SectionAnalysisError("section_interrupted", true);
        output = await this.executor.execute(
          {
            task_id: owned.id,
            run_id: owned.runId,
            process_id: owned.processId,
            object_id: owned.objectId,
            resolved_input_hash: owned.resolvedInputHash,
            source_fingerprint: owned.sourceFingerprint,
            matrix_import_id: owned.matrixImportId,
            matrix_sha256: await this.matrixSha256(owned.matrixImportId),
            snapshot: snapshot.snapshot as unknown as IdentificationSnapshot,
            matrix_rows: owned.matrixRows as unknown as SectionMatrixRow[],
            artifact_ids: artifactIds,
            readArtifact: async (artifactId) => {
              const meta = artifactIndex.get(artifactId);
              if (!meta) return null;
              try {
                return await this.artifacts.read(
                  meta.storageKey,
                  meta.artifactSha256,
                  meta.sourceSha256,
                  meta.pipelineFingerprint,
                  "stored",
                );
              } catch {
                return null;
              }
            },
            index,
            heartbeat: renew,
          },
          inner.signal,
        );
      } catch (error) {
        await this.failure(
          owned,
          error instanceof SectionAnalysisError
            ? error.code
            : inner.signal.aborted
              ? "section_interrupted"
              : "section_engine_failed",
          {
            retryable:
              !(error instanceof SectionAnalysisError) || error.retryable,
          },
        );
        return;
      }
      // Cancellation observed at any point after the claim — the lock wait,
      // executor work or its last await — must never end in publication.
      if (inner.signal.aborted) {
        await this.failure(owned, "section_interrupted", {
          retryable: true,
        });
        return;
      }
      // Returned technical failures are not successes: retryable provider
      // outcomes take the same bounded retry/final-failure path, and the
      // partial output is preserved on the terminal record for inspection.
      const retryableFailure = output.failures.find(
        (failure) => failure.retryable,
      );
      if (retryableFailure) {
        await this.failure(owned, retryableFailure.code, {
          retryable: true,
          result: output,
        });
        return;
      }
      // Non-retryable provider/contract failures (HTTP 4xx, invalid results,
      // schema violations) are terminal technical failures. Legitimate domain
      // outcomes like the call budget bound stay on the success path.
      const terminalFailure = output.failures.find(
        (failure) =>
          !failure.retryable && !DOMAIN_FAILURE_CODES.has(failure.code),
      );
      if (terminalFailure) {
        await this.failure(owned, terminalFailure.code, {
          retryable: false,
          result: output,
        });
        return;
      }
      // Publication replays every fence under the object/process locks: a
      // stale source, rotated run, different matrix basis or cancelled
      // process makes the late result durable-but-failed instead of visible.
      let published = false;
      try {
        await this.prisma.$transaction(
          async (tx) => {
            if (inner.signal.aborted) return;
            const basis = await this.lockedBasis(tx, owned.runId);
            const task = await tx.sectionAnalysisTask.findUniqueOrThrow({
              where: { id: owned.id },
            });
            if (
              task.state !== "processing" ||
              task.leaseToken !== owned.leaseToken ||
              !task.leaseUntil ||
              task.leaseUntil.getTime() <= Date.now()
            )
              return;
            if (!basis || !(await this.basisHolds(tx, basis, task))) {
              await this.failInTx(tx, task, "section_superseded");
              return;
            }
            if (inner.signal.aborted) return;
            const wrote = await tx.sectionAnalysisTask.updateMany({
              where: {
                id: task.id,
                state: "processing",
                leaseToken: owned.leaseToken,
                leaseUntil: { gt: new Date() },
              },
              data: {
                state: "succeeded",
                result: JSON.parse(
                  JSON.stringify(output),
                ) as Prisma.InputJsonValue,
                leaseToken: null,
                leaseUntil: null,
                completedAt: new Date(),
              },
            });
            if (!wrote.count) return;
            // Aborting mid-commit rolls the success write back instead of
            // committing a result the worker was told to discard.
            if (inner.signal.aborted)
              throw new SectionAnalysisError("section_interrupted", true);
            published = true;
            await writeOutboxEvent(tx, {
              data: {
                eventType: "section_analysis.succeeded",
                payload: {
                  schema_version: 1,
                  event_type: "section_analysis.succeeded",
                  task_id: task.id,
                  run_id: task.runId,
                  fingerprint: task.fingerprint,
                },
              },
            });
          },
          { timeout: 60_000 },
        );
      } catch (error) {
        if (
          error instanceof SectionAnalysisError &&
          error.code === "section_interrupted"
        ) {
          await this.failure(owned, "section_interrupted", {
            retryable: true,
          });
          return;
        }
        throw error;
      }
      // An abort that landed during the publication lock wait left the row
      // processing under this lease; turn it into a bounded retry.
      if (!published && inner.signal.aborted)
        await this.failure(owned, "section_interrupted", { retryable: true });
    } finally {
      clearInterval(heartbeat);
      clearTimeout(hardBound);
      signal?.removeEventListener("abort", stop);
    }
  }

  /** Conditional terminal transition; a changed state/token owns the row. */
  private async failInTx(
    tx: Prisma.TransactionClient,
    task: Pick<SectionAnalysisTask, "id" | "runId" | "state">,
    code: string,
  ) {
    const wrote = await tx.sectionAnalysisTask.updateMany({
      where: { id: task.id, state: task.state },
      data: {
        state: "failed",
        errorCode: code,
        leaseToken: null,
        leaseUntil: null,
        completedAt: new Date(),
      },
    });
    if (!wrote.count) return;
    await writeOutboxEvent(tx, {
      data: {
        eventType: "section_analysis.failed",
        payload: {
          schema_version: 1,
          event_type: "section_analysis.failed",
          task_id: task.id,
          run_id: task.runId,
          error_code: code,
        },
      },
    });
  }

  /**
   * Lease-token fenced failure. A retry is only armed while the basis is
   * still current and the attempt budget is unspent; terminal failures emit
   * the durable event. requireExpiredLease makes expiry recovery a no-op
   * when a live heartbeat renewed the lease between selection and lock.
   */
  private async failure(
    owned: SectionAnalysisTask,
    code: string,
    options: {
      retryable: boolean;
      requireExpiredLease?: boolean;
      result?: SectionAnalysisOutput;
    },
  ) {
    await this.prisma.$transaction(async (tx) => {
      const basis = await this.lockedBasis(tx, owned.runId);
      const task = await tx.sectionAnalysisTask.findUniqueOrThrow({
        where: { id: owned.id },
      });
      if (task.state !== "processing" || task.leaseToken !== owned.leaseToken)
        return;
      if (
        options.requireExpiredLease &&
        (!task.leaseUntil || task.leaseUntil.getTime() > Date.now())
      )
        return;
      const retry = Boolean(
        options.retryable &&
        task.attempts < 3 &&
        basis &&
        (await this.basisHolds(tx, basis, task)),
      );
      const wrote = await tx.sectionAnalysisTask.updateMany({
        where: {
          id: task.id,
          state: "processing",
          leaseToken: owned.leaseToken,
        },
        data: {
          state: retry ? "queued" : "failed",
          errorCode: code,
          leaseUntil: null,
          leaseToken: null,
          availableAt: new Date(Date.now() + 1000 * 4 ** task.attempts),
          completedAt: retry ? null : new Date(),
          ...(retry || !options.result
            ? {}
            : {
                result: JSON.parse(
                  JSON.stringify(options.result),
                ) as Prisma.InputJsonValue,
              }),
        },
      });
      if (!wrote.count) return;
      if (retry) {
        const next = await tx.sectionAnalysisTask.findUniqueOrThrow({
          where: { id: task.id },
        });
        await this.enqueue(tx, next);
      } else {
        await writeOutboxEvent(tx, {
          data: {
            eventType: "section_analysis.failed",
            payload: {
              schema_version: 1,
              event_type: "section_analysis.failed",
              task_id: task.id,
              run_id: task.runId,
              error_code: code,
            },
          },
        });
      }
    });
  }

  private async matrixSha256(importId: string) {
    const record = await this.prisma.matrixImport.findUniqueOrThrow({
      where: { id: importId },
    });
    return record.sourceSha256;
  }

  // --- Provider-free helpers for verification/protocol integration ---

  /** The currently selected basis: task of the latest NEW admission receipt. */
  async selectedTask(
    tx: Prisma.TransactionClient,
    runId: string,
  ): Promise<SectionAnalysisTask | null> {
    const receipt = await tx.sectionAnalysisReceipt.findFirst({
      where: { runId },
      orderBy: { seq: "desc" },
      include: { task: true },
    });
    return receipt?.task ?? null;
  }

  /** All section tasks bound to one resolved-input snapshot, newest first. */
  async snapshotTasks(
    tx: Prisma.TransactionClient,
    runId: string,
    resolvedInputHash: string,
  ): Promise<SectionAnalysisTask[]> {
    return tx.sectionAnalysisTask.findMany({
      where: { runId, resolvedInputHash },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  }
}

/**
 * The matrix import a Run pins for section analysis: the immutable catalog of
 * its rule-set release when present, otherwise the latest import at admission
 * or fence time. Shared by admission, recovery and publication.
 */
export async function selectedMatrixImportId(
  tx: Prisma.TransactionClient,
  run: { ruleSetRelease: { manifest: Prisma.JsonValue } | null },
): Promise<string | null> {
  const manifest = run.ruleSetRelease?.manifest as unknown as
    ReleaseManifest | undefined;
  const pinned = manifest?.catalog?.import_id;
  if (typeof pinned === "string") return pinned;
  const latest = await tx.matrixImport.findFirst({
    orderBy: [{ importedAt: "desc" }, { id: "desc" }],
  });
  return latest?.id ?? null;
}

/** Artifact ids referenced by the stored provenance manifest. */
export function manifestArtifactIds(manifest: Prisma.JsonValue): string[] {
  const ids = new Set<string>();
  if (typeof manifest !== "object" || manifest === null) return [];
  const contexts = (manifest as { contexts?: unknown }).contexts;
  if (!Array.isArray(contexts)) return [];
  for (const context of contexts) {
    const sources = (context as { sources?: unknown }).sources;
    if (!Array.isArray(sources)) continue;
    for (const source of sources) {
      const id = (source as { artifact_id?: unknown }).artifact_id;
      if (typeof id === "string") ids.add(id);
    }
  }
  return [...ids];
}

/** Executor provider for the real core engine over the live configuration. */
export function sectionExecutorFromConfig(
  config: ConfigService,
): SectionAnalysisExecutor {
  try {
    return createSectionExecutor(readSectionAnalysisConfig(config));
  } catch {
    // An invalid section config must not take the module down; admission is
    // refused through the disabled flag and health surfaces the cause.
    return disabledSectionExecutor;
  }
}
