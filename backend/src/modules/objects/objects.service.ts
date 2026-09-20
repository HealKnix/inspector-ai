import { Injectable } from "@nestjs/common";
import type { ConstructionObject } from "../../generated/prisma/client.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import {
  ObjectAccessService,
  type AuditContext,
} from "./object-access.service.js";
import type { PageQueryDto } from "./objects.dto.js";

function present(object: ConstructionObject) {
  return {
    id: object.id,
    name: object.name,
    created_by: object.createdBy,
    created_at: object.createdAt.toISOString(),
    updated_at: object.updatedAt.toISOString(),
    allowed_actions: ["upload"],
  };
}

@Injectable()
export class ObjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ObjectAccessService,
  ) {}

  create(context: AuditContext, name: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.requireInspector(tx, context.userId);
      const object = await tx.constructionObject.create({
        data: {
          name,
          createdBy: context.userId,
          access: {
            create: { userId: context.userId, grantedBy: context.userId },
          },
        },
      });
      await tx.auditEvent.create({
        data: {
          ...context,
          objectId: object.id,
          action: "object.created",
          details: { schema_version: 1, initial_user_id: context.userId },
        },
      });
      return present(object);
    });
  }

  list(userId: string, { page, limit }: PageQueryDto) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.access.requireInspector(tx, userId);
        const where = { access: { some: { userId } } };
        const items = await tx.constructionObject.findMany({
          where,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (page - 1) * limit,
          take: limit,
        });
        const total = await tx.constructionObject.count({ where });
        return {
          items: items.map(present),
          total,
          page,
          limit,
          allowed_actions: ["create"],
        };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }

  get(userId: string, objectId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, userId, objectId);
      return present(
        await tx.constructionObject.findUniqueOrThrow({
          where: { id: objectId },
        }),
      );
    });
  }
}
