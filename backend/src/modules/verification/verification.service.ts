import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import type { Evaluation } from "../completeness/completeness-contract.js";
import { isApplicable } from "../completeness/completeness-engine.js";
import type { GroupMember } from "../extraction/comparison-engine.js";
import { ExtractionJobsService } from "../extraction/extraction-jobs.service.js";
import {
  ObjectAccessService,
  type AuditContext,
} from "../objects/object-access.service.js";
import { buildProtocol, protocolContent } from "./protocol-builder.js";
import {
  decisionTarget,
  REJECTION_REASON_CODES,
  VERIFICATION_SCHEMA_VERSION,
  type DecisionAction,
  type FindingStatusValue,
} from "./verification-contract.js";

export interface ProtocolRow {
  id: string;
  version: number;
  status: string;
  scenario: string;
  created_at: Date;
  finalized_at: Date | null;
  findings: number;
}

export interface DecisionInput {
  request_id: string;
  action: DecisionAction;
  finding_version: number;
  reason_code?: string;
  comment?: string;
}

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ObjectAccessService,
    private readonly jobs: ExtractionJobsService,
  ) {}

  private async currentProcess(tx: Prisma.TransactionClient, objectId: string) {
    const process = await tx.process.findFirst({
      where: { objectId },
      orderBy: { createdAt: "desc" },
    });
    if (!process) throw new NotFoundException("Процесс обработки не создан");
    return process;
  }

  /**
   * Explicit protocol generation (VER-01): snapshot of the current run's
   * evidence groups becomes a new protocol version. Idempotent on
   * findings_hash; refuses while the run still has non-terminal tasks.
   */
  async generate(context: AuditContext, objectId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, context.userId, objectId);
      const process = await this.currentProcess(tx, objectId);
      if (["PARSING", "FINALIZED"].includes(process.status)) {
        throw new ConflictException(
          `Протокол недоступен в статусе ${process.status}`,
        );
      }
      const run = await tx.run.findFirst({
        where: { processId: process.id, version: process.version },
      });
      if (!run) throw new ConflictException("Нет запуска текущей версии");
      const [{ pending }] = await tx.$queryRaw<[{ pending: number }]>`
        SELECT (
          (SELECT count(*) FROM parsing_tasks
            WHERE run_id = ${run.id}::uuid
              AND state IN ('queued', 'processing'))
        + (SELECT count(*) FROM classification_tasks ct
            JOIN parse_artifacts a ON a.id = ct.artifact_id
            JOIN parsing_tasks pt ON pt.id = a.task_id
            WHERE pt.run_id = ${run.id}::uuid
              AND ct.state IN ('queued', 'processing'))
        + (SELECT count(*) FROM extraction_tasks et
            JOIN parse_artifacts a ON a.id = et.artifact_id
            JOIN parsing_tasks pt ON pt.id = a.task_id
            WHERE pt.run_id = ${run.id}::uuid
              AND et.state IN ('queued', 'processing'))
        )::int AS pending`;
      if (pending > 0)
        throw new ConflictException(
          `Обработка не завершена: незавершённых задач ${pending}`,
        );

      const groups = await tx.evidenceGroup.findMany({
        where: { processId: process.id },
        orderBy: [{ parameterCode: "asc" }, { scopeKey: "asc" }],
      });
      const rules = await this.jobs.approvedRules(tx);
      const executable = new Set(rules.map((rule) => rule.parameter_code));
      const versions = await tx.ruleVersion.findMany({
        where: { status: "approved", parameterCode: { in: [...executable] } },
        orderBy: [{ parameterCode: "asc" }, { version: "desc" }],
        select: { parameterCode: true, applicability: true },
      });
      const applicability = new Map<string, unknown>();
      for (const version of versions)
        if (!applicability.has(version.parameterCode))
          applicability.set(version.parameterCode, version.applicability);
      const pack = await tx.packageVersion.findFirst({
        where: { objectId, status: "confirmed" },
        orderBy: { version: "desc" },
        select: { attributes: true },
      });
      const attributes = (pack?.attributes ?? {}) as Record<string, unknown>;

      const source = await tx.matrixImport.findFirst({
        orderBy: { importedAt: "desc" },
      });
      const rows = source
        ? await tx.matrixRow.findMany({
            where: { importId: source.id },
            orderBy: { parameterId: "asc" },
          })
        : [];
      const latestCompleteness = await tx.completenessResult.findFirst({
        where: { processId: process.id },
        orderBy: { createdAt: "desc" },
      });
      const fileIds = new Set<string>();
      for (const group of groups)
        for (const member of (group.members as unknown as GroupMember[]) ?? [])
          if (member?.file_id) fileIds.add(member.file_id);
      const files = fileIds.size
        ? await tx.file.findMany({
            where: { id: { in: [...fileIds] } },
            select: { id: true, sha256: true },
          })
        : [];
      const fileSha256 = new Map(files.map((file) => [file.id, file.sha256]));

      const built = buildProtocol({
        parameters: rows.map((row) => ({
          parameter_code: row.parameterCode,
          criticality: row.criticality,
          relevant_stages: (
            [
              ["PD", row.sourcePd],
              ["RD", row.sourceRd],
              ["ID", row.sourceId],
            ] as const
          )
            .filter(([, src]) => Boolean(src))
            .map(([stage]) => stage),
          has_rule: executable.has(row.parameterCode),
          applicable: isApplicable(
            applicability.get(row.parameterCode),
            attributes,
          ),
        })),
        groups: groups.map((group) => ({
          id: group.id,
          parameter_code: group.parameterCode,
          scope_key: group.scopeKey,
          ruleset_hash: group.rulesetHash,
          members: group.members,
          verdict: group.verdict,
        })),
        evaluation: (latestCompleteness?.result as Evaluation | null) ?? null,
        fileSha256,
      });

      const active = await tx.protocol.findFirst({
        where: { processId: process.id, status: "active" },
        include: { findings: { include: { decisions: true } } },
      });
      if (active?.findingsHash === built.findings_hash) {
        return {
          schema_version: VERIFICATION_SCHEMA_VERSION,
          object_id: objectId,
          protocol_id: active.id,
          protocol_version: active.version,
          status: active.status,
          findings: built.findings.length,
          reused: true,
        };
      }
      if (active) {
        await tx.protocol.update({
          where: { id: active.id },
          data: { status: "superseded" },
        });
      }
      const carried = new Map(
        (active?.findings ?? [])
          .filter(
            (finding) =>
              finding.decidedBy !== null &&
              built.findings.some(
                (next) =>
                  next.parameter_code === finding.parameterCode &&
                  next.scope_key === finding.scopeKey &&
                  next.members_fingerprint === finding.membersFingerprint,
              ),
          )
          .map((finding) => [
            `${finding.parameterCode}|${finding.scopeKey}`,
            finding,
          ]),
      );
      const protocol = await tx.protocol.create({
        data: {
          objectId,
          processId: process.id,
          runId: run.id,
          version: await this.nextVersion(tx, process.id),
          scenario: built.scenario ?? "PARTIALLY_LOADED",
          rulesetHash: groups[0]?.rulesetHash ?? null,
          inputManifestHash: run.inputManifestHash,
          findingsHash: built.findings_hash,
          completenessResultId: latestCompleteness?.id ?? null,
          content: protocolContent(
            built,
            latestCompleteness?.id ?? null,
          ) as unknown as Prisma.InputJsonValue,
          createdBy: context.userId,
        },
      });
      for (const finding of built.findings) {
        const previous = carried.get(
          `${finding.parameter_code}|${finding.scope_key}`,
        );
        const created = await tx.finding.create({
          data: {
            protocolId: protocol.id,
            objectId,
            processId: process.id,
            parameterCode: finding.parameter_code,
            scopeKey: finding.scope_key,
            status: previous?.status ?? finding.status,
            risk: finding.risk,
            evidenceGroupId: finding.evidence_group_id,
            verdict: finding.verdict
              ? (finding.verdict as unknown as Prisma.InputJsonValue)
              : undefined,
            gateReasons: finding.gate_reasons,
            membersFingerprint: finding.members_fingerprint,
            decidedBy: previous?.decidedBy ?? null,
            decidedAt: previous?.decidedAt ?? null,
            reasonCode: previous?.reasonCode ?? null,
            comment: previous?.comment ?? null,
            rowVersion: previous?.rowVersion ?? 1,
          },
        });
        for (const decision of previous?.decisions ?? []) {
          await tx.findingDecision.create({
            data: {
              findingId: created.id,
              actorId: decision.actorId,
              action: decision.action,
              fromStatus: decision.fromStatus,
              toStatus: decision.toStatus,
              reasonCode: decision.reasonCode,
              comment: decision.comment,
              createdAt: decision.createdAt,
            },
          });
        }
      }
      if (process.status !== "READY") {
        await tx.process.update({
          where: { id: process.id },
          data: { status: "READY" },
        });
      }
      await tx.auditEvent.create({
        data: {
          ...context,
          objectId,
          action: "protocol.generated",
          details: {
            schema_version: VERIFICATION_SCHEMA_VERSION,
            protocol_id: protocol.id,
            protocol_version: protocol.version,
            run_id: run.id,
            ruleset_hash: protocol.rulesetHash,
            input_manifest_hash: run.inputManifestHash,
            findings_hash: built.findings_hash,
            scenario: protocol.scenario,
            findings: built.findings.length,
            carried_decisions: carried.size,
          },
        },
      });
      await tx.outbox.create({
        data: {
          eventType: "protocol.generated",
          payload: {
            schema_version: VERIFICATION_SCHEMA_VERSION,
            object_id: objectId,
            process_id: process.id,
            run_id: run.id,
            protocol_id: protocol.id,
            protocol_version: protocol.version,
            actor: context.userId,
          },
        },
      });
      return {
        schema_version: VERIFICATION_SCHEMA_VERSION,
        object_id: objectId,
        protocol_id: protocol.id,
        protocol_version: protocol.version,
        status: protocol.status,
        findings: built.findings.length,
        reused: false,
      };
    });
  }

  private async nextVersion(
    tx: Prisma.TransactionClient,
    processId: string,
  ): Promise<number> {
    const last = await tx.protocol.findFirst({
      where: { processId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    return (last?.version ?? 0) + 1;
  }

  /** Имя параметра из последнего импорта матрицы — для карточек находок. */
  private async parameterNames(
    tx: Prisma.TransactionClient,
    codes: readonly string[],
  ) {
    const source = await tx.matrixImport.findFirst({
      orderBy: { importedAt: "desc" },
      select: { id: true },
    });
    if (!source || codes.length === 0) return new Map<string, string>();
    const rows = await tx.matrixRow.findMany({
      where: { importId: source.id, parameterCode: { in: [...codes] } },
      select: { parameterCode: true, name: true },
    });
    return new Map(rows.map((row) => [row.parameterCode, row.name]));
  }

  private serializeFinding(
    finding: {
      id: string;
      parameterCode: string;
      scopeKey: string;
      status: string;
      risk: string | null;
      reasonCode: string | null;
      comment: string | null;
      decidedAt: Date | null;
      rowVersion: number;
      gateReasons: unknown;
      verdict: unknown;
    },
    names?: ReadonlyMap<string, string>,
  ) {
    return {
      id: finding.id,
      parameter_code: finding.parameterCode,
      parameter_name: names?.get(finding.parameterCode) ?? null,
      scope_key: finding.scopeKey,
      status: finding.status,
      risk: finding.risk,
      reason_code: finding.reasonCode,
      comment: finding.comment,
      decided_at: finding.decidedAt?.toISOString() ?? null,
      finding_version: finding.rowVersion,
      gate_reasons: finding.gateReasons,
      verdict: finding.verdict,
    };
  }

  /** Активная версия протокола + история версий процесса. */
  async getProtocol(userId: string, objectId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, userId, objectId);
      const process = await this.currentProcess(tx, objectId);
      const versions = await tx.$queryRaw<ProtocolRow[]>`
        SELECT p.id, p.version, p.status::text AS status, p.scenario,
               p.created_at, p.finalized_at,
               (SELECT count(*) FROM findings f
                 WHERE f.protocol_id = p.id)::int AS findings
        FROM protocols p
        WHERE p.process_id = ${process.id}::uuid
        ORDER BY p.version DESC`;
      const active = versions.find((row) => row.status === "active") ?? null;
      return {
        schema_version: VERIFICATION_SCHEMA_VERSION,
        object_id: objectId,
        process_status: process.status,
        protocol: active,
        versions,
        protocol_absent_reason: active ? null : "protocol_not_generated",
      };
    });
  }

  async listFindings(
    userId: string,
    objectId: string,
    filter: { status?: FindingStatusValue; q?: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, userId, objectId);
      const process = await this.currentProcess(tx, objectId);
      const protocol = await tx.protocol.findFirst({
        where: { processId: process.id, status: "active" },
      });
      if (!protocol)
        return {
          schema_version: VERIFICATION_SCHEMA_VERSION,
          object_id: objectId,
          protocol_id: null,
          items: [],
          findings_absent_reason: "protocol_not_generated",
        };
      const items = await tx.finding.findMany({
        where: {
          protocolId: protocol.id,
          ...(filter.status ? { status: filter.status } : {}),
          ...(filter.q
            ? { parameterCode: { contains: filter.q.toUpperCase() } }
            : {}),
        },
        orderBy: [{ parameterCode: "asc" }, { scopeKey: "asc" }],
      });
      const names = await this.parameterNames(
        tx,
        items.map((finding) => finding.parameterCode),
      );
      return {
        schema_version: VERIFICATION_SCHEMA_VERSION,
        object_id: objectId,
        protocol_id: protocol.id,
        items: items.map((finding) => this.serializeFinding(finding, names)),
        findings_absent_reason: null,
      };
    });
  }

  /** Карточка находки: снимок вердикта, члены группы и локаторы evidence. */
  async getFinding(userId: string, objectId: string, findingId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, userId, objectId);
      const finding = await tx.finding.findFirst({
        where: { id: findingId, objectId },
        include: {
          decisions: { orderBy: { createdAt: "asc" } },
          protocol: { select: { version: true, status: true } },
        },
      });
      if (!finding) throw new NotFoundException("Находка недоступна");
      const group = finding.evidenceGroupId
        ? await tx.evidenceGroup.findUnique({
            where: { id: finding.evidenceGroupId },
            select: { members: true },
          })
        : null;
      const extractionIds = ((group?.members as unknown as GroupMember[]) ?? [])
        .map((member) => member.extraction_id)
        .filter(Boolean);
      const fragments = extractionIds.length
        ? await tx.evidenceFragment.findMany({
            where: { extractionId: { in: extractionIds } },
            select: {
              extractionId: true,
              fileId: true,
              pageNumber: true,
              sheetLabel: true,
              blockId: true,
              quote: true,
              bbox: true,
            },
          })
        : [];
      const byExtraction = new Map<string, typeof fragments>();
      for (const fragment of fragments) {
        const list = byExtraction.get(fragment.extractionId) ?? [];
        list.push(fragment);
        byExtraction.set(fragment.extractionId, list);
      }
      const names = await this.parameterNames(tx, [finding.parameterCode]);
      return {
        schema_version: VERIFICATION_SCHEMA_VERSION,
        object_id: objectId,
        finding: {
          ...this.serializeFinding(finding, names),
          protocol_version: finding.protocol.version,
          members: ((group?.members as unknown as GroupMember[]) ?? []).map(
            (member) => ({
              ...member,
              evidence: byExtraction.get(member.extraction_id) ?? [],
            }),
          ),
          decisions: finding.decisions.map((decision) => ({
            id: decision.id,
            actor_id: decision.actorId,
            action: decision.action,
            from_status: decision.fromStatus,
            to_status: decision.toStatus,
            reason_code: decision.reasonCode,
            comment: decision.comment,
            created_at: decision.createdAt.toISOString(),
          })),
        },
      };
    });
  }

  /**
   * Inspector decision (VER-03): receipt replay → process state → transition
   * table → optimistic row_version → finding + history + receipt + process
   * transition, all in one transaction.
   */
  async decide(
    context: AuditContext,
    objectId: string,
    findingId: string,
    input: DecisionInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, context.userId, objectId);
      const receipt = await tx.findingDecisionReceipt.findUnique({
        where: {
          userId_objectId_requestId: {
            userId: context.userId,
            objectId,
            requestId: input.request_id,
          },
        },
      });
      if (receipt) {
        const finding = await tx.finding.findUniqueOrThrow({
          where: { id: receipt.findingId },
        });
        const names = await this.parameterNames(tx, [finding.parameterCode]);
        return {
          schema_version: VERIFICATION_SCHEMA_VERSION,
          object_id: objectId,
          finding: this.serializeFinding(finding, names),
          replayed: true,
        };
      }
      const process = await this.currentProcess(tx, objectId);
      if (!["READY", "VERIFYING"].includes(process.status)) {
        throw new ConflictException(
          `Верификация недоступна в статусе ${process.status}`,
        );
      }
      const finding = await tx.finding.findFirst({
        where: { id: findingId, objectId },
        include: { protocol: true },
      });
      if (!finding) throw new NotFoundException("Находка недоступна");
      if (finding.protocol.status !== "active")
        throw new ConflictException(
          "Решения принимаются только по активной версии протокола",
        );
      if (input.finding_version !== finding.rowVersion)
        throw new ConflictException(
          `Находка изменилась: актуальная версия ${finding.rowVersion}, передана ${input.finding_version}`,
        );
      const target = decisionTarget(input.action, finding.status);
      if (!target)
        throw new ConflictException(
          `Переход ${input.action} недопустим для статуса ${finding.status}`,
        );
      if (input.action === "reject") {
        if (
          !input.reason_code ||
          !REJECTION_REASON_CODES.includes(
            input.reason_code as (typeof REJECTION_REASON_CODES)[number],
          )
        )
          throw new BadRequestException(
            "Отклонение требует reason_code из справочника",
          );
        if (!input.comment?.trim())
          throw new BadRequestException("Отклонение требует комментария");
      }
      if (input.action === "clarify" && !input.comment?.trim())
        throw new BadRequestException("Уточнение требует комментария");
      const updated = await tx.finding.update({
        where: { id: finding.id },
        data: {
          status: target,
          decidedBy: context.userId,
          decidedAt: new Date(),
          reasonCode: input.reason_code ?? null,
          comment: input.comment ?? null,
          rowVersion: { increment: 1 },
        },
      });
      const decision = await tx.findingDecision.create({
        data: {
          findingId: finding.id,
          actorId: context.userId,
          action: input.action,
          fromStatus: finding.status,
          toStatus: target,
          reasonCode: input.reason_code ?? null,
          comment: input.comment ?? null,
        },
      });
      await tx.findingDecisionReceipt.create({
        data: {
          userId: context.userId,
          objectId,
          requestId: input.request_id,
          findingId: finding.id,
          decisionId: decision.id,
        },
      });
      // READY → VERIFYING на первом решении; VERIFYING → COMPLETED, когда
      // кандидатов в активной версии не осталось (D7).
      let status: typeof process.status = process.status;
      if (status === "READY") status = "VERIFYING";
      if (status === "VERIFYING") {
        const [{ open }] = await tx.$queryRaw<[{ open: number }]>`
          SELECT count(*)::int AS open FROM findings
          WHERE protocol_id = ${finding.protocolId}::uuid
            AND status = 'CANDIDATE'`;
        if (open === 0) status = "COMPLETED";
      }
      if (status !== process.status) {
        await tx.process.update({
          where: { id: process.id },
          data: { status },
        });
      }
      await tx.auditEvent.create({
        data: {
          ...context,
          objectId,
          action: "finding.decision",
          details: {
            schema_version: VERIFICATION_SCHEMA_VERSION,
            finding_id: finding.id,
            protocol_id: finding.protocolId,
            parameter_code: finding.parameterCode,
            scope_key: finding.scopeKey,
            decision: input.action,
            from_status: finding.status,
            to_status: target,
            reason_code: input.reason_code ?? null,
            request_id: input.request_id,
          },
        },
      });
      const names = await this.parameterNames(tx, [updated.parameterCode]);
      return {
        schema_version: VERIFICATION_SCHEMA_VERSION,
        object_id: objectId,
        finding: this.serializeFinding(updated, names),
        process_status: status,
        replayed: false,
      };
    });
  }

  /** VER-04: финализация только при нуле CANDIDATE в активной версии. */
  async finalize(context: AuditContext, objectId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, context.userId, objectId);
      const process = await this.currentProcess(tx, objectId);
      if (!["READY", "VERIFYING", "COMPLETED"].includes(process.status))
        throw new ConflictException(
          `Финализация недоступна в статусе ${process.status}`,
        );
      const protocol = await tx.protocol.findFirst({
        where: { processId: process.id, status: "active" },
      });
      if (!protocol) throw new ConflictException("Протокол не сформирован");
      const open = await tx.finding.findMany({
        where: { protocolId: protocol.id, status: "CANDIDATE" },
        select: { parameterCode: true, scopeKey: true },
      });
      if (open.length > 0)
        throw new ConflictException(
          `Неразрешённые находки: ${open
            .map((finding) => finding.parameterCode)
            .join(", ")}`,
        );
      await tx.protocol.update({
        where: { id: protocol.id },
        data: {
          status: "finalized",
          finalizedBy: context.userId,
          finalizedAt: new Date(),
        },
      });
      await tx.process.update({
        where: { id: process.id },
        data: { status: "FINALIZED" },
      });
      await tx.auditEvent.create({
        data: {
          ...context,
          objectId,
          action: "protocol.finalized",
          details: {
            schema_version: VERIFICATION_SCHEMA_VERSION,
            protocol_id: protocol.id,
            protocol_version: protocol.version,
          },
        },
      });
      await tx.outbox.create({
        data: {
          eventType: "protocol.finalized",
          payload: {
            schema_version: VERIFICATION_SCHEMA_VERSION,
            object_id: objectId,
            process_id: process.id,
            protocol_id: protocol.id,
            protocol_version: protocol.version,
            actor: context.userId,
          },
        },
      });
      return {
        schema_version: VERIFICATION_SCHEMA_VERSION,
        object_id: objectId,
        protocol_id: protocol.id,
        protocol_version: protocol.version,
        status: "finalized",
        process_status: "FINALIZED",
      };
    });
  }

  /** Отмена финализации — только администратор, с обязательной причиной. */
  async cancelFinalization(
    context: AuditContext,
    objectId: string,
    input: { reason: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      const actor = await tx.user.findUnique({
        where: { id: context.userId },
      });
      if (actor?.role !== "ADMINISTRATOR")
        throw new ForbiddenException(
          "Отменой финализации управляет администратор",
        );
      if (!input.reason?.trim())
        throw new BadRequestException("Отмена финализации требует причины");
      const process = await this.currentProcess(tx, objectId);
      if (process.status !== "FINALIZED")
        throw new ConflictException("Процесс не финализирован");
      const protocol = await tx.protocol.findFirst({
        where: { processId: process.id, status: "finalized" },
      });
      if (!protocol) throw new ConflictException("Протокол не финализирован");
      await tx.protocol.update({
        where: { id: protocol.id },
        data: { status: "active", finalizedBy: null, finalizedAt: null },
      });
      await tx.process.update({
        where: { id: process.id },
        data: { status: "COMPLETED" },
      });
      await tx.auditEvent.create({
        data: {
          ...context,
          objectId,
          action: "protocol.finalization_cancelled",
          details: {
            schema_version: VERIFICATION_SCHEMA_VERSION,
            protocol_id: protocol.id,
            protocol_version: protocol.version,
            reason: input.reason,
          },
        },
      });
      await tx.outbox.create({
        data: {
          eventType: "protocol.finalization_cancelled",
          payload: {
            schema_version: VERIFICATION_SCHEMA_VERSION,
            object_id: objectId,
            process_id: process.id,
            protocol_id: protocol.id,
            protocol_version: protocol.version,
            actor: context.userId,
            reason: input.reason,
          },
        },
      });
      return {
        schema_version: VERIFICATION_SCHEMA_VERSION,
        object_id: objectId,
        protocol_id: protocol.id,
        protocol_version: protocol.version,
        status: "active",
        process_status: "COMPLETED",
      };
    });
  }
}
