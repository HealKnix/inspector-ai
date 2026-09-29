import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  Prisma,
  SectionAnalysisTask,
} from "../../generated/prisma/client.js";
import { writeAuditEvent } from "../../infrastructure/audit/audit-envelope.js";
import {
  record,
  uuid,
} from "../../infrastructure/observability/trace-context.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import type {
  ComparisonContext,
  IdentificationSnapshot,
  RevisionReference,
} from "../identification/identification-contract.js";
import {
  identificationHash,
  identificationJson,
  identificationSources,
} from "../identification/identification-state.js";
import {
  ObjectAccessService,
  type AuditContext,
} from "../objects/object-access.service.js";
import type { ReleaseManifest } from "./rule-set-release.js";
import {
  SectionAnalysisJobsService,
  selectedMatrixImportId,
} from "./section-analysis-jobs.service.js";
import {
  validateSectionMatrixRows,
  type SectionMatrixRow,
} from "./section-contract.js";

const ACTIVE_STATUSES = ["PENDING", "PARSING", "READY", "VERIFYING"];
const PARAMETER_CODE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const MAX_PARAMETERS = 132;
const POLL_AFTER_MS = 2000;

/** Physical source provenance of one resolved comparison role. */
export interface ManifestSource {
  role: "reference" | "actual";
  document_id: string;
  revision_id: string;
  document_stage: string | null;
  file_id: string;
  artifact_id: string;
  artifact_sha256: string;
  source_sha256: string;
  selection_hash: string | null;
  /** Selected physical pages; null when the artifact is used in full. */
  pages: number[] | null;
}

export interface SectionSourceManifest {
  contexts: {
    context_id: string;
    scope: string;
    works_period: { from: string | null; to: string | null };
    sources: ManifestSource[];
  }[];
}

function revisionOf(
  snapshot: IdentificationSnapshot,
  documentId: string,
  revisionId: string,
) {
  return (
    snapshot.documents
      .find((document) => document.document_id === documentId)
      ?.revisions.find((revision) => revision.revision_id === revisionId) ??
    null
  );
}

/**
 * Identity resolution mirrors section-context.roleSources without loading
 * artifacts: the recorded source list is exactly what the engine resolves at
 * execution time, so the manifest is verifiable provenance, not a copy of
 * engine internals.
 */
function roleSources(
  snapshot: IdentificationSnapshot,
  context: ComparisonContext,
  role: "reference" | "actual",
  ref: RevisionReference | null,
): ManifestSource[] {
  const revision = ref
    ? revisionOf(snapshot, ref.document_id, ref.revision_id)
    : null;
  if (!ref || !revision) return [];
  const stage = revision.fields.stage ?? null;
  const selection = context.sheet_selection?.[role] ?? null;
  if (selection) {
    const artifactIds = [
      ...new Set(selection.sheets.map((sheet) => sheet.artifact_id)),
    ];
    const sources: ManifestSource[] = [];
    for (const artifactId of artifactIds) {
      const sheets = selection.sheets.filter(
        (sheet) => sheet.artifact_id === artifactId,
      );
      const first = sheets[0]!;
      const consistent = sheets.every(
        (sheet) =>
          sheet.document_id === first.document_id &&
          sheet.revision_id === first.revision_id &&
          sheet.file_id === first.file_id &&
          sheet.artifact_sha256 === first.artifact_sha256 &&
          sheet.source_sha256 === first.source_sha256,
      );
      const owner = consistent
        ? revisionOf(snapshot, first.document_id, first.revision_id)
        : null;
      if (!consistent || !owner) continue;
      sources.push({
        role,
        document_id: first.document_id,
        revision_id: first.revision_id,
        document_stage: owner.fields.stage ?? null,
        file_id: first.file_id,
        artifact_id: artifactId,
        artifact_sha256: first.artifact_sha256,
        source_sha256: first.source_sha256,
        selection_hash: selection.selection_hash,
        pages: sheets.map((sheet) => sheet.page_number),
      });
    }
    return sources;
  }
  if (revision.sheet_map || revision.sheet_replacement) return [];
  return revision.representations.map((representation) => ({
    role,
    document_id: ref.document_id,
    revision_id: ref.revision_id,
    document_stage: stage,
    file_id: representation.file_id,
    artifact_id: representation.artifact_id,
    artifact_sha256: representation.artifact_sha256,
    source_sha256: representation.source_sha256,
    selection_hash: null,
    pages: null,
  }));
}

/** Material input provenance of a snapshot: READY contexts only. */
export function sectionSourceManifest(
  snapshot: IdentificationSnapshot,
): SectionSourceManifest {
  return {
    contexts: snapshot.contexts
      .filter((context) => context.status === "READY")
      .map((context) => ({
        context_id: context.context_id,
        scope: context.scope,
        works_period: context.works_period,
        sources: [
          ...roleSources(snapshot, context, "reference", context.reference),
          ...roleSources(snapshot, context, "actual", context.actual),
        ],
      })),
  };
}

function presentTask(task: SectionAnalysisTask, stale = false) {
  const rows = Array.isArray(task.matrixRows)
    ? (task.matrixRows as unknown as SectionMatrixRow[])
    : [];
  return {
    id: task.id,
    state: task.state,
    error_code: task.errorCode,
    cycle: task.cycle,
    attempts: task.attempts,
    fingerprint: task.fingerprint,
    config_fingerprint: task.configFingerprint,
    matrix_import_id: task.matrixImportId,
    resolved_input_hash: task.resolvedInputHash,
    source_fingerprint: task.sourceFingerprint,
    parameter_codes: rows.map((row) => row.parameter_code),
    stale,
    created_at: task.createdAt,
    completed_at: task.completedAt,
  };
}

@Injectable()
export class SectionAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ObjectAccessService,
    private readonly jobs: SectionAnalysisJobsService,
  ) {}

  private parseBody(body: unknown) {
    if (!record(body))
      throw new BadRequestException("Некорректное тело запроса");
    if (
      !Object.keys(body).every((key) =>
        ["request_id", "expected_run_id", "parameter_codes"].includes(key),
      )
    )
      throw new BadRequestException("Запрос содержит неизвестные поля");
    const requestId = uuid(body.request_id);
    const expectedRunId = uuid(body.expected_run_id);
    if (!requestId || !expectedRunId)
      throw new BadRequestException(
        "request_id и expected_run_id должны быть UUID",
      );
    const raw = body.parameter_codes;
    if (raw === undefined || raw === null)
      return { requestId, expectedRunId, codes: null };
    if (
      !Array.isArray(raw) ||
      raw.length === 0 ||
      raw.length > MAX_PARAMETERS ||
      raw.some((code) => typeof code !== "string" || !PARAMETER_CODE.test(code))
    )
      throw new BadRequestException(
        "parameter_codes должен быть непустым списком кодов параметров",
      );
    if (new Set(raw).size !== raw.length)
      throw new BadRequestException(
        "parameter_codes содержит повторяющийся код параметра",
      );
    return { requestId, expectedRunId, codes: raw as string[] };
  }

  /** Selected run scope identical to extraction: explicit or latest current. */
  private async selectedScope(
    tx: Prisma.TransactionClient,
    objectId: string,
    runId?: string,
  ) {
    const latestProcess = runId
      ? null
      : await tx.process.findFirst({
          where: { objectId },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        });
    const run = runId
      ? await tx.run.findFirst({
          where: { id: runId, objectId },
          include: { process: true },
        })
      : latestProcess
        ? await tx.run.findFirst({
            where: {
              processId: latestProcess.id,
              version: latestProcess.version,
              objectId,
            },
            include: { process: true },
          })
        : null;
    if (runId && !run)
      throw new NotFoundException("Запуск обработки недоступен");
    const snapshot = run
      ? await tx.resolvedInputSnapshot.findFirst({
          where: {
            runId: run.id,
            objectId,
            inputManifestHash: run.inputManifestHash,
          },
          orderBy: { version: "desc" },
        })
      : null;
    return {
      run,
      snapshot,
      current: Boolean(run && run.version === run.process.version),
    };
  }

  /** GET: progress and current result of the selected analysis basis. */
  async status(userId: string, objectId: string, runId?: string) {
    const { enabled } = this.jobs.executorState();
    return this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, userId, objectId);
      const { run, snapshot, current } = await this.selectedScope(
        tx,
        objectId,
        runId,
      );
      const task = run ? await this.jobs.selectedTask(tx, run.id) : null;
      // Historical task rows stay readable, but a result is only "current"
      // while its full basis (sources, snapshot, matrix, config) still holds
      // on the same run — a clarification or reparse must not keep serving
      // facts computed against the replaced snapshot.
      const fresh = Boolean(
        current && task && (await this.jobs.taskBasisHolds(tx, task)),
      );
      return {
        schema_version: 1,
        enabled,
        process_id: run?.processId ?? null,
        run_id: run?.id ?? null,
        resolved_input_hash: snapshot?.resolvedInputHash ?? null,
        current,
        active: Boolean(task && ["queued", "processing"].includes(task.state)),
        poll_after_ms: POLL_AFTER_MS,
        task: task ? presentTask(task, task ? !fresh : false) : null,
        results: task?.state === "succeeded" && fresh ? task.result : null,
      };
    });
  }

  /**
   * POST: admit a bounded analysis of real matrix rows against the current
   * resolved snapshot. A replayed request_id returns its recorded receipt and
   * never re-selects; every NEW admission selects its task as the run basis.
   */
  async start(context: AuditContext, objectId: string, body: unknown) {
    const input = this.parseBody(body);
    const { enabled, configFingerprint } = this.jobs.executorState();
    const bodyHash = identificationHash({
      kind: "section_analysis_request",
      expected_run_id: input.expectedRunId,
      parameter_codes: input.codes,
    });
    return this.prisma.$transaction(
      async (tx) => {
        await this.access.lock(tx, objectId);
        await this.access.requireAccess(tx, context.userId, objectId);
        const receipt = await tx.sectionAnalysisReceipt.findUnique({
          where: {
            userId_objectId_requestId: {
              userId: context.userId,
              objectId,
              requestId: input.requestId,
            },
          },
          include: { task: true },
        });
        if (receipt) {
          if (receipt.bodyHash !== bodyHash)
            throw new ConflictException(
              "request_id уже использован с другим содержимым запроса",
            );
          return {
            schema_version: 1 as const,
            request_id: input.requestId,
            task: presentTask(receipt.task),
          };
        }
        if (!enabled || !configFingerprint)
          throw new ConflictException(
            "Секционный анализ отключён конфигурацией",
          );
        const run = await tx.run.findFirst({
          where: { id: input.expectedRunId, objectId },
          include: { process: true, ruleSetRelease: true },
        });
        if (!run) throw new NotFoundException("Запуск обработки недоступен");
        await tx.$queryRaw`SELECT id FROM processes WHERE id=${run.processId}::uuid FOR UPDATE`;
        const process = await tx.process.findUniqueOrThrow({
          where: { id: run.processId },
        });
        if (
          run.version !== process.version ||
          !ACTIVE_STATUSES.includes(process.status)
        )
          throw new ConflictException(
            "Запуск не является текущим или процесс закрыт для анализа",
          );
        const source = await identificationSources(tx, run.id);
        const snapshot = await tx.resolvedInputSnapshot.findUnique({
          where: {
            runId_sourceFingerprint: {
              runId: run.id,
              sourceFingerprint: source.fingerprint,
            },
          },
        });
        if (!source.ready || !snapshot)
          throw new ConflictException(
            "Снимок источников ещё не опубликован; дождитесь идентификации",
          );
        const importId = await selectedMatrixImportId(tx, run);
        const matrixImport = importId
          ? await tx.matrixImport.findUnique({ where: { id: importId } })
          : null;
        if (!matrixImport)
          throw new ConflictException("Матрица контроля недоступна");
        const pinned = run.ruleSetRelease?.manifest as unknown as
          ReleaseManifest | undefined;
        if (
          pinned?.catalog &&
          pinned.catalog.import_id === matrixImport.id &&
          pinned.catalog.catalog_sha256 !== matrixImport.sourceSha256
        )
          throw new ConflictException(
            "Закреплённый каталог матрицы не соответствует импорту",
          );
        const rows = await tx.matrixRow.findMany({
          where: { importId: matrixImport.id },
          orderBy: { parameterId: "asc" },
        });
        const descriptors: SectionMatrixRow[] = rows.map((row) => ({
          parameter_code: row.parameterCode,
          name: row.name,
          unit: row.unit,
          source_pd: row.sourcePd,
          source_rd: row.sourceRd,
          source_id: row.sourceId,
          trigger: row.triggerText,
        }));
        const available = new Map(
          descriptors.map((row) => [row.parameter_code, row] as const),
        );
        const selected = input.codes
          ? input.codes.map((code) => {
              const row = available.get(code);
              if (!row)
                throw new BadRequestException(
                  `Неизвестный код параметра: ${code}`,
                );
              return row;
            })
          : descriptors;
        if (!selected.length)
          throw new BadRequestException(
            "Матрица контроля не содержит параметров для анализа",
          );
        const matrixRows = validateSectionMatrixRows(
          JSON.parse(JSON.stringify(selected)),
        );
        const manifest = sectionSourceManifest(
          snapshot.snapshot as unknown as IdentificationSnapshot,
        );
        const fingerprint = identificationHash({
          kind: "section_analysis",
          resolved_input_hash: snapshot.resolvedInputHash,
          source_fingerprint: source.fingerprint,
          matrix_sha256: matrixImport.sourceSha256,
          matrix_rows: matrixRows,
          source_manifest: manifest,
          config_fingerprint: configFingerprint,
        });
        const previous = await tx.sectionAnalysisTask.findFirst({
          where: { runId: run.id, fingerprint },
          orderBy: { cycle: "desc" },
        });
        const task =
          previous && previous.state !== "failed"
            ? previous
            : await this.jobs.createTask(tx, {
                runId: run.id,
                processId: run.processId,
                objectId: run.objectId,
                cycle: (previous?.cycle ?? 0) + 1,
                fingerprint,
                resolvedInputHash: snapshot.resolvedInputHash,
                sourceFingerprint: source.fingerprint,
                configFingerprint,
                matrixImportId: matrixImport.id,
                matrixRows: identificationJson(matrixRows),
                sourceManifest: identificationJson(manifest),
              });
        await tx.sectionAnalysisReceipt.create({
          data: {
            userId: context.userId,
            objectId,
            requestId: input.requestId,
            runId: run.id,
            taskId: task.id,
            fingerprint,
            bodyHash,
          },
        });
        await writeAuditEvent(tx, {
          data: {
            userId: context.userId,
            objectId,
            requestId: context.requestId,
            ip: context.ip,
            action: "section_analysis.requested",
            details: {
              schema_version: 1,
              task_id: task.id,
              request_id: input.requestId,
              resolved_input_hash: snapshot.resolvedInputHash,
              source_fingerprint: source.fingerprint,
              matrix_id: matrixImport.id,
              state: task.state,
            },
          },
        });
        return {
          schema_version: 1 as const,
          request_id: input.requestId,
          task: presentTask(task),
        };
      },
      { timeout: 30_000 },
    );
  }
}
