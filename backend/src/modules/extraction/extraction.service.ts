import { Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { ObjectAccessService } from "../objects/object-access.service.js";
import type { ExtractionOutcome } from "./extraction-contract.js";
import { rulesetFingerprint } from "./extraction-engine.js";
import { ExtractionJobsService } from "./extraction-jobs.service.js";

export interface ExtractionRow {
  id: string;
  task_id: string;
  artifact_id: string;
  file_id: string;
  original_name: string;
  parameter_code: string;
  rule_version_id: string;
  status: ExtractionOutcome["status"];
  stage: string | null;
  value_raw: string | null;
  value: unknown;
  unit: string | null;
  alternatives: unknown;
  reason: string | null;
  created_at: Date;
}

export interface ExtractionTaskRow {
  task_id: string;
  artifact_id: string;
  file_id: string;
  original_name: string;
  state: string;
  error_code: string | null;
  fingerprint: string;
}

export interface EvidenceGroupRow {
  id: string;
  parameter_code: string;
  scope_key: string;
  ruleset_hash: string;
  members: unknown;
  verdict: unknown;
  updated_at: Date;
}

@Injectable()
export class ExtractionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ObjectAccessService,
    private readonly jobs: ExtractionJobsService,
  ) {}

  /** Resolve the requested Run before reading facts; no current-data fallback. */
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
    const selection = run
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
      selection,
      current: Boolean(run && run.version === run.process.version),
    };
  }

  async list(userId: string, objectId: string, runId?: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, userId, objectId);
      const { run, selection, current } = await this.selectedScope(
        tx,
        objectId,
        runId,
      );
      const scope = {
        process_id: run?.processId ?? null,
        run_id: run?.id ?? null,
        resolved_input_hash: selection?.resolvedInputHash ?? null,
        current,
      };
      if (!run || !selection)
        return {
          schema_version: 1,
          ...scope,
          ruleset_fingerprint: null,
          active: false,
          poll_after_ms: 2000,
          items: [],
          tasks: [],
        };
      const items = await tx.$queryRaw<ExtractionRow[]>`
        SELECT e.id, e.task_id, e.artifact_id, e.file_id, f.original_name,
               e.parameter_code, e.rule_version_id, e.status, e.stage,
               e.value_raw, e.value, e.unit, e.alternatives, e.reason, e.created_at
        FROM extractions e
        JOIN extraction_tasks t ON t.id=e.task_id
        JOIN parse_artifacts a ON a.id=t.artifact_id AND a.id=e.artifact_id
        JOIN parsing_tasks pt ON pt.id=a.task_id AND pt.file_id=e.file_id
        JOIN files f ON f.id=e.file_id
        JOIN LATERAL (
          SELECT id FROM extraction_tasks newer
          WHERE newer.artifact_id=t.artifact_id
            AND newer.resolved_input_hash=${selection.resolvedInputHash}
          ORDER BY newer.cycle DESC, newer.id DESC LIMIT 1
        ) latest ON latest.id=t.id
        WHERE e.object_id=${objectId}::uuid AND e.run_id=${run.id}::uuid
          AND pt.run_id=${run.id}::uuid AND pt.object_id=${objectId}::uuid
          AND t.resolved_input_hash=${selection.resolvedInputHash}
        ORDER BY e.parameter_code, f.original_name, e.id`;
      const tasks = await tx.$queryRaw<ExtractionTaskRow[]>`
        SELECT t.id AS task_id, t.artifact_id, pt.file_id, f.original_name,
               t.state, t.error_code, t.fingerprint
        FROM extraction_tasks t
        JOIN parse_artifacts a ON a.id=t.artifact_id
        JOIN parsing_tasks pt ON pt.id=a.task_id
        JOIN files f ON f.id=pt.file_id
        JOIN LATERAL (
          SELECT id FROM extraction_tasks newer
          WHERE newer.artifact_id=t.artifact_id
            AND newer.resolved_input_hash=${selection.resolvedInputHash}
          ORDER BY newer.cycle DESC, newer.id DESC LIMIT 1
        ) latest ON latest.id=t.id
        WHERE pt.object_id=${objectId}::uuid AND pt.run_id=${run.id}::uuid
          AND t.resolved_input_hash=${selection.resolvedInputHash}
        ORDER BY f.original_name, t.id`;
      const fragments = items.length
        ? await tx.evidenceFragment.findMany({
            where: { extractionId: { in: items.map((item) => item.id) } },
            orderBy: [
              { extractionId: "asc" },
              { pageNumber: "asc" },
              { id: "asc" },
            ],
          })
        : [];
      const evidence = fragments.map((fragment) => ({
        extraction_id: fragment.extractionId,
        file_id: fragment.fileId,
        artifact_id: fragment.artifactId,
        page_number: fragment.pageNumber,
        sheet_label: fragment.sheetLabel,
        block_id: fragment.blockId,
        table_id: fragment.tableId,
        table_row: fragment.tableRow,
        table_column: fragment.tableColumn,
        quote: fragment.quote,
        bbox: fragment.bbox,
        structural_path: fragment.structuralPath,
      }));
      const fingerprints = [...new Set(tasks.map((task) => task.fingerprint))];
      const currentRules =
        current && !tasks.length ? await this.jobs.approvedRules(tx) : [];
      // Historical configuration is the one recorded on these tasks; do not
      // relabel an old result with today's approved ruleset.
      const fingerprint =
        fingerprints.length === 1
          ? fingerprints[0]!
          : currentRules.length
            ? rulesetFingerprint(currentRules)
            : null;
      return {
        schema_version: 1,
        ...scope,
        ruleset_fingerprint: fingerprint,
        active:
          current &&
          tasks.some((task) => ["queued", "processing"].includes(task.state)),
        poll_after_ms: 2000,
        items: items.map((item) => ({
          ...item,
          evidence: evidence.filter(
            (fragment) => fragment.extraction_id === item.id,
          ),
        })),
        tasks,
      };
    });
  }

  /** Immutable comparison groups belonging to this Run and source selection. */
  async groups(userId: string, objectId: string, runId?: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, userId, objectId);
      const { run, selection, current } = await this.selectedScope(
        tx,
        objectId,
        runId,
      );
      const scope = {
        process_id: run?.processId ?? null,
        run_id: run?.id ?? null,
        resolved_input_hash: selection?.resolvedInputHash ?? null,
        current,
      };
      if (!run || !selection) return { schema_version: 1, ...scope, items: [] };
      const items = await tx.$queryRaw<EvidenceGroupRow[]>`
        SELECT DISTINCT ON (g.parameter_code,g.context_key)
               g.id,g.parameter_code,g.scope_key,g.ruleset_hash,g.members,
               g.verdict,g.updated_at,g.run_id,g.resolved_input_hash,g.context_key
        FROM evidence_groups g
        WHERE g.object_id=${objectId}::uuid AND g.run_id=${run.id}::uuid
          AND g.resolved_input_hash=${selection.resolvedInputHash}
        ORDER BY g.parameter_code,g.context_key,g.version DESC,g.id DESC`;
      return { schema_version: 1, ...scope, items };
    });
  }
}
