import { Injectable } from "@nestjs/common";
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

  /**
   * Extraction outcomes for the current process version: one row per
   * (parameter, file) plus per-artifact task states. Extractions are facts —
   * they never carry a violation verdict.
   */
  async list(userId: string, objectId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, userId, objectId);
      const rules = await this.jobs.approvedRules(tx);
      const fingerprint = rules.length ? rulesetFingerprint(rules) : null;
      const items = await tx.$queryRaw<ExtractionRow[]>`
        SELECT e.id, e.task_id, e.artifact_id, e.file_id, f.original_name,
               e.parameter_code, e.rule_version_id, e.status, e.stage,
               e.value_raw, e.value, e.unit, e.alternatives, e.reason, e.created_at
        FROM extractions e
        JOIN extraction_tasks t ON t.id = e.task_id
        JOIN files f ON f.id = e.file_id
        JOIN LATERAL (
          SELECT id, fingerprint FROM extraction_tasks newer
          WHERE newer.artifact_id = t.artifact_id
          ORDER BY newer.cycle DESC LIMIT 1
        ) latest ON latest.id = t.id
        WHERE e.object_id = ${objectId}::uuid
          AND e.process_id = (SELECT id FROM processes WHERE object_id = ${objectId}::uuid ORDER BY created_at DESC LIMIT 1)
        ORDER BY e.parameter_code, f.original_name`;
      const tasks = await tx.$queryRaw<ExtractionTaskRow[]>`
        SELECT t.id AS task_id, t.artifact_id, pt.file_id, f.original_name,
               t.state, t.error_code
        FROM extraction_tasks t
        JOIN parse_artifacts a ON a.id = t.artifact_id
        JOIN parsing_tasks pt ON pt.id = a.task_id
        JOIN files f ON f.id = pt.file_id
        JOIN LATERAL (
          SELECT id FROM extraction_tasks newer
          WHERE newer.artifact_id = t.artifact_id
          ORDER BY newer.cycle DESC LIMIT 1
        ) latest ON latest.id = t.id
        WHERE pt.object_id = ${objectId}::uuid
        ORDER BY f.original_name`;
      const evidence = await tx.$queryRaw<
        {
          extraction_id: string;
          file_id: string;
          artifact_id: string;
          page_number: number;
          sheet_label: string | null;
          block_id: string | null;
          table_id: string | null;
          table_row: number | null;
          table_column: number | null;
          quote: string;
          bbox: unknown;
          structural_path: string | null;
        }[]
      >`
        SELECT ef.extraction_id, ef.file_id, ef.artifact_id, ef.page_number,
               ef.sheet_label, ef.block_id, ef.table_id, ef.table_row,
               ef.table_column, ef.quote, ef.bbox, ef.structural_path
        FROM evidence_fragments ef
        JOIN extractions e ON e.id = ef.extraction_id
        WHERE e.object_id = ${objectId}::uuid`;
      const byExtraction = new Map<string, typeof evidence>();
      for (const fragment of evidence) {
        const list = byExtraction.get(fragment.extraction_id) ?? [];
        list.push(fragment);
        byExtraction.set(fragment.extraction_id, list);
      }
      return {
        schema_version: 1,
        ruleset_fingerprint: fingerprint,
        active: tasks.some((task) =>
          ["queued", "processing"].includes(task.state),
        ),
        poll_after_ms: 2000,
        items: items.map((item) => ({
          ...item,
          evidence: byExtraction.get(item.id) ?? [],
        })),
        tasks,
      };
    });
  }

  /**
   * Parameter-level groups: expected (PD) vs actual (RD/ID) members plus the
   * persisted preliminary verdict computed at rebuild time. A verdict is
   * review input, never an inspector's decision.
   */
  async groups(userId: string, objectId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, userId, objectId);
      const items = await tx.$queryRaw<EvidenceGroupRow[]>`
        SELECT g.id, g.parameter_code, g.scope_key, g.ruleset_hash, g.members,
               g.verdict, g.updated_at
        FROM evidence_groups g
        WHERE g.object_id = ${objectId}::uuid
          AND g.process_id = (SELECT id FROM processes WHERE object_id = ${objectId}::uuid ORDER BY created_at DESC LIMIT 1)
        ORDER BY g.parameter_code`;
      return { schema_version: 1, items };
    });
  }
}
