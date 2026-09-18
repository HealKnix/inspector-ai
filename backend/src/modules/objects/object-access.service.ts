import { ForbiddenException, Injectable } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";

export interface AuditContext {
  userId: string;
  requestId: string;
  ip?: string;
}

@Injectable()
export class ObjectAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async lock(tx: Prisma.TransactionClient, objectId: string) {
    // The same lock is used by admission and access changes, including replay.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${objectId}, 0))`;
  }

  async requireInspector(tx: Prisma.TransactionClient, userId: string) {
    const users = await tx.$queryRaw<
      { role: string | null }[]
    >`SELECT role FROM users WHERE id = ${userId} FOR SHARE`;
    if (users[0]?.role !== "INSPECTOR")
      throw new ForbiddenException("Нет разрешения на работу с объектами");
  }

  async requireAccess(
    tx: Prisma.TransactionClient,
    userId: string,
    objectId: string,
  ) {
    await this.requireInspector(tx, userId);
    const access = await tx.objectAccess.findUnique({
      where: { objectId_userId: { objectId, userId } },
    });
    if (!access) throw new ForbiddenException("Объект недоступен");
  }

  async check(userId: string, objectId: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, objectId);
      await this.requireAccess(tx, userId, objectId);
    });
  }

  async setAssignment(
    context: AuditContext,
    objectId: string,
    userId: string,
    grant: boolean,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, objectId);
      const actor = await tx.user.findUnique({ where: { id: context.userId } });
      if (actor?.role !== "ADMINISTRATOR")
        throw new ForbiddenException("Назначениями управляет администратор");
      const target = await tx.user.findUnique({ where: { id: userId } });
      if (
        !target ||
        !(await tx.constructionObject.findUnique({ where: { id: objectId } }))
      )
        throw new ForbiddenException("Назначение недоступно");
      if (grant && target.role !== "INSPECTOR")
        throw new ForbiddenException("Доступ назначается инспектору");
      if (grant) {
        await tx.objectAccess.upsert({
          where: { objectId_userId: { objectId, userId } },
          create: { objectId, userId, grantedBy: context.userId },
          update: {},
        });
      } else {
        await tx.objectAccess.deleteMany({ where: { objectId, userId } });
      }
      await tx.auditEvent.create({
        data: {
          ...context,
          objectId,
          action: grant ? "object.access.granted" : "object.access.revoked",
          details: { target_user_id: userId, schema_version: 1 },
        },
      });
    });
  }
}
