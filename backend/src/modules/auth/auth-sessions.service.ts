import { Injectable } from "@nestjs/common";

import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";

interface CreateAuthSessionInput {
  expiresAt: Date;
  id: string;
  refreshTokenHash: string;
  userId: string;
}

interface RotateAuthSessionInput extends CreateAuthSessionInput {
  currentRefreshTokenHash: string;
}

@Injectable()
export class AuthSessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async isActive(id: string, userId: string): Promise<boolean> {
    const session = await this.prisma.authSession.findFirst({
      where: { expiresAt: { gt: new Date() }, id, revokedAt: null, userId },
      select: { id: true },
    });

    return session !== null;
  }

  async create(input: CreateAuthSessionInput): Promise<void> {
    await this.prisma.authSession.create({ data: input });
  }

  async rotate(input: RotateAuthSessionInput): Promise<boolean> {
    const result = await this.prisma.authSession.updateMany({
      where: {
        expiresAt: { gt: new Date() },
        id: input.id,
        refreshTokenHash: input.currentRefreshTokenHash,
        revokedAt: null,
        userId: input.userId,
      },
      data: {
        expiresAt: input.expiresAt,
        refreshTokenHash: input.refreshTokenHash,
      },
    });

    return result.count === 1;
  }

  async revoke(
    id: string,
    userId: string,
    refreshTokenHash: string,
  ): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { id, refreshTokenHash, revokedAt: null, userId },
      data: { revokedAt: new Date() },
    });
  }
}
