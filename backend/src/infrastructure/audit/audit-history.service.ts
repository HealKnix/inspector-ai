import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client.js";
import { ObjectAccessService } from "../../modules/objects/object-access.service.js";
import { record, uuid } from "../observability/trace-context.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { presentAuditEvent } from "./audit-envelope.js";

interface HistoryQuery {
  limit?: number;
  cursor?: string;
  protocol_id?: string;
}
function cursorBoundary(cursor: string | undefined, scope: string) {
  if (!cursor) return null;
  try {
    if (cursor.length > 1024) throw new Error();
    const value: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (
      !record(value) ||
      value.scope !== scope ||
      !uuid(value.id) ||
      typeof value.at !== "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.at) ||
      !Number.isFinite(Date.parse(value.at))
    )
      throw new Error();
    return { id: String(value.id), at: new Date(value.at) };
  } catch {
    throw new BadRequestException("Некорректный курсор истории");
  }
}

@Injectable()
export class AuditHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ObjectAccessService,
  ) {}

  list(userId: string, objectId: string, query: HistoryQuery) {
    const limit = query.limit ?? 50;
    const scope = `${objectId}:${query.protocol_id ?? ""}`;
    const cursor = cursorBoundary(query.cursor, scope);
    return this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, userId, objectId);
      if (
        query.protocol_id &&
        !(await tx.protocol.findFirst({
          where: { id: query.protocol_id, objectId },
          select: { id: true },
        }))
      )
        throw new NotFoundException("Версия протокола недоступна");
      const conditions: Prisma.AuditEventWhereInput[] = [{ objectId }];
      if (query.protocol_id)
        conditions.push({
          details: { path: ["protocol_id"], equals: query.protocol_id },
        });
      if (cursor)
        conditions.push({
          OR: [
            { createdAt: { lt: cursor.at } },
            { createdAt: cursor.at, id: { lt: cursor.id } },
          ],
        });
      const rows = await tx.auditEvent.findMany({
        where: { AND: conditions },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
      });
      const page = rows.slice(0, limit);
      const requestIds = page.flatMap((row) => {
        const id =
          record(row.details) && row.action === "finding.decision"
            ? uuid(row.details.request_id)
            : null;
        return id ? [id] : [];
      });
      const receipts = requestIds.length
        ? await tx.findingDecisionReceipt.findMany({
            where: { objectId, requestId: { in: requestIds } },
            include: { decision: true },
          })
        : [];
      const last = page.at(-1);
      return {
        schema_version: 1,
        object_id: objectId,
        protocol_id: query.protocol_id ?? null,
        items: page.map((row) => {
          const details = record(row.details) ? row.details : {};
          const saved = receipts.find(
            (receipt) =>
              receipt.requestId === details.request_id &&
              receipt.userId === row.userId &&
              receipt.findingId === details.finding_id,
          )?.decision;
          return {
            ...presentAuditEvent(row),
            decision: saved
              ? {
                  decision_id: saved.id,
                  finding_id: saved.findingId,
                  actor_id: saved.actorId,
                  action: saved.action,
                  from_status: saved.fromStatus,
                  to_status: saved.toStatus,
                  reason_code: saved.reasonCode,
                  comment: saved.comment,
                  occurred_at: saved.createdAt.toISOString(),
                }
              : null,
          };
        }),
        next_cursor:
          rows.length > limit && last
            ? Buffer.from(
                JSON.stringify({
                  scope,
                  id: last.id,
                  at: last.createdAt.toISOString(),
                }),
              ).toString("base64url")
            : null,
      };
    });
  }
}
