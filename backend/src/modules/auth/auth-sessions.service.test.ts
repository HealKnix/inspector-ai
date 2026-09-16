import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { AuthSessionsService } from "./auth-sessions.service.js";

interface SessionQueryInput {
  where: {
    expiresAt: { gt: Date };
    id: string;
    refreshTokenHash?: string;
    revokedAt: null;
    userId: string;
  };
}

describe("AuthSessionsService", () => {
  const authSession = {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  };
  const prisma = { authSession };
  let service: AuthSessionsService;

  beforeEach(async () => {
    vi.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthSessionsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(AuthSessionsService);
  });

  it("считает действующей только неотозванную и непросроченную сессию", async () => {
    authSession.findFirst.mockResolvedValue({ id: "session-id" });

    await expect(service.isActive("session-id", "user-id")).resolves.toBe(true);
    const query = authSession.findFirst.mock.calls[0]?.[0] as
      (SessionQueryInput & { select: { id: true } }) | undefined;

    expect(query?.where.expiresAt.gt).toBeInstanceOf(Date);
    expect(query).toMatchObject({
      where: { id: "session-id", revokedAt: null, userId: "user-id" },
      select: { id: true },
    });
  });

  it("заменяет refresh-хеш только при совпадении текущего хеша", async () => {
    authSession.updateMany.mockResolvedValue({ count: 1 });
    const expiresAt = new Date("2026-10-01T00:00:00.000Z");

    await expect(
      service.rotate({
        currentRefreshTokenHash: "current-hash",
        expiresAt,
        id: "session-id",
        refreshTokenHash: "next-hash",
        userId: "user-id",
      }),
    ).resolves.toBe(true);
    const update = authSession.updateMany.mock.calls[0]?.[0] as
      | (SessionQueryInput & {
          data: { expiresAt: Date; refreshTokenHash: string };
        })
      | undefined;

    expect(update?.where.expiresAt.gt).toBeInstanceOf(Date);
    expect(update).toMatchObject({
      where: {
        id: "session-id",
        refreshTokenHash: "current-hash",
        revokedAt: null,
        userId: "user-id",
      },
      data: { expiresAt, refreshTokenHash: "next-hash" },
    });
  });
});
