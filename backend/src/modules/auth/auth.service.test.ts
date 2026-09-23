import { ConflictException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UsersService } from "../users/users.service.js";
import { AuthSessionsService } from "./auth-sessions.service.js";
import { AuthService } from "./auth.service.js";
import { PasswordService } from "./password.service.js";

interface SessionMutationInput {
  currentRefreshTokenHash?: string;
  expiresAt: Date;
  id: string;
  refreshTokenHash: string;
  userId: string;
}

type SignCall = [Record<string, unknown>, Record<string, unknown>];

const config: Record<string, unknown> = {
  JWT_ACCESS_TTL_SECONDS: 1200,
  JWT_REFRESH_SECRET: "test-refresh-secret-with-at-least-32-characters",
  JWT_REFRESH_TTL_SECONDS: 604_800,
  JWT_SECRET: "test-access-secret-with-at-least-32-characters",
};

describe("AuthService", () => {
  const user = {
    id: "8c15a0d2-4328-4d6d-8426-49f10b0f679c",
    login: "inspector.ivanov",
    role: null,
    lastName: "Иванов",
    firstName: "Иван",
    patronymic: null,
    phone: null,
    email: null,
    createdAt: new Date("2026-09-15T12:00:00.000Z"),
  };
  const usersService = {
    create: vi.fn(),
    findById: vi.fn(),
    findCredentialsByLogin: vi.fn(),
  };
  const passwordService = {
    hash: vi.fn(),
    verify: vi.fn(),
  };
  const jwtService = {
    signAsync: vi.fn(),
    verifyAsync: vi.fn(),
  };
  const authSessionsService = {
    create: vi.fn(),
    revoke: vi.fn(),
    rotate: vi.fn(),
  };
  const configService = {
    getOrThrow: (key: string) => {
      const value = config[key];

      if (value === undefined) {
        throw new Error(`Missing test config: ${key}`);
      }

      return value;
    },
  };

  let service: AuthService;

  beforeEach(async () => {
    vi.resetAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersService },
        { provide: PasswordService, useValue: passwordService },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: AuthSessionsService, useValue: authSessionsService },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  function mockTokenPair(
    accessToken = "signed-access-token",
    refreshToken = "signed-refresh-token",
  ) {
    jwtService.signAsync
      .mockResolvedValueOnce(accessToken)
      .mockResolvedValueOnce(refreshToken);
  }

  it("создаёт пользователя, серверную refresh-сессию и пару JWT", async () => {
    usersService.findCredentialsByLogin.mockResolvedValue(null);
    passwordService.hash.mockResolvedValue("scrypt$salt$key");
    usersService.create.mockResolvedValue(user);
    authSessionsService.create.mockResolvedValue(undefined);
    mockTokenPair();

    await expect(
      service.register({
        login: "  Inspector.Ivanov ",
        password: "correct-horse-2026",
        lastName: "Иванов",
        firstName: "Иван",
      }),
    ).resolves.toEqual({
      accessToken: "signed-access-token",
      refreshToken: "signed-refresh-token",
      user,
    });
    expect(usersService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        login: "inspector.ivanov",
        passwordHash: "scrypt$salt$key",
      }),
    );
    const createdSession = authSessionsService.create.mock.calls[0]?.[0] as
      SessionMutationInput | undefined;
    expect(createdSession?.expiresAt).toBeInstanceOf(Date);
    expect(createdSession?.id).toEqual(expect.any(String));
    expect(createdSession?.refreshTokenHash).toMatch(/^[a-f\d]{64}$/);
    expect(createdSession?.userId).toBe(user.id);

    const accessCall = jwtService.signAsync.mock.calls[0] as
      SignCall | undefined;
    const refreshCall = jwtService.signAsync.mock.calls[1] as
      SignCall | undefined;
    expect(accessCall?.[0]).toMatchObject({
      sub: user.id,
      tokenType: "access",
    });
    expect(accessCall?.[0].sid).toEqual(expect.any(String));
    expect(accessCall?.[1]).toMatchObject({
      audience: "inspector-ai-web",
      expiresIn: 1200,
    });
    expect(refreshCall?.[0]).toMatchObject({
      sub: user.id,
      tokenType: "refresh",
    });
    expect(refreshCall?.[0].sid).toEqual(expect.any(String));
    expect(refreshCall?.[1]).toMatchObject({
      audience: "inspector-ai-refresh",
      expiresIn: 604_800,
    });
  });

  it("не раскрывает, существует ли логин, при неверном пароле", async () => {
    usersService.findCredentialsByLogin.mockResolvedValue({
      ...user,
      passwordHash: "stored-hash",
    });
    passwordService.verify.mockResolvedValue(false);

    await expect(
      service.login("inspector.ivanov", "incorrect-password"),
    ).rejects.toThrow(new UnauthorizedException("Неверный логин или пароль"));
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });

  it("выполняет проверку хеша и для отсутствующего логина", async () => {
    usersService.findCredentialsByLogin.mockResolvedValue(null);
    passwordService.verify.mockResolvedValue(false);

    await expect(
      service.login("missing-user", "incorrect-password"),
    ).rejects.toThrow(new UnauthorizedException("Неверный логин или пароль"));
    expect(passwordService.verify).toHaveBeenCalledOnce();
  });

  it("не создаёт повторного пользователя", async () => {
    usersService.findCredentialsByLogin.mockResolvedValue({
      ...user,
      passwordHash: "stored-hash",
    });

    await expect(
      service.register({
        login: "inspector.ivanov",
        password: "correct-horse-2026",
        lastName: "Иванов",
        firstName: "Иван",
      }),
    ).rejects.toThrow(
      new ConflictException("Пользователь с таким логином уже зарегистрирован"),
    );
  });

  it("атомарно ротирует refresh token и продлевает серверную сессию", async () => {
    jwtService.verifyAsync.mockResolvedValue({
      jti: "current-token-id",
      sid: "session-id",
      sub: user.id,
      tokenType: "refresh",
    });
    usersService.findById.mockResolvedValue(user);
    authSessionsService.rotate.mockResolvedValue(true);
    mockTokenPair("next-access-token", "next-refresh-token");

    await expect(service.refresh("current-refresh-token")).resolves.toEqual({
      accessToken: "next-access-token",
      refreshToken: "next-refresh-token",
      user,
    });
    const rotation = authSessionsService.rotate.mock.calls[0]?.[0] as
      SessionMutationInput | undefined;
    expect(rotation?.currentRefreshTokenHash).toMatch(/^[a-f\d]{64}$/);
    expect(rotation?.expiresAt).toBeInstanceOf(Date);
    expect(rotation?.id).toBe("session-id");
    expect(rotation?.refreshTokenHash).toMatch(/^[a-f\d]{64}$/);
    expect(rotation?.userId).toBe(user.id);
  });

  it("отклоняет уже заменённый refresh token", async () => {
    jwtService.verifyAsync.mockResolvedValue({
      jti: "old-token-id",
      sid: "session-id",
      sub: user.id,
      tokenType: "refresh",
    });
    usersService.findById.mockResolvedValue(user);
    authSessionsService.rotate.mockResolvedValue(false);
    mockTokenPair("unused-access-token", "unused-refresh-token");

    await expect(service.refresh("old-refresh-token")).rejects.toThrow(
      new UnauthorizedException("Сессия недействительна"),
    );
  });

  it("отзывает refresh-сессию при выходе", async () => {
    jwtService.verifyAsync.mockResolvedValue({
      jti: "current-token-id",
      sid: "session-id",
      sub: user.id,
      tokenType: "refresh",
    });
    authSessionsService.revoke.mockResolvedValue(undefined);

    await service.logout("current-refresh-token");

    expect(authSessionsService.revoke).toHaveBeenCalledWith(
      "session-id",
      user.id,
      expect.stringMatching(/^[a-f\d]{64}$/),
    );
  });

  it("не принимает JWT с неверным payload как refresh token", async () => {
    jwtService.verifyAsync.mockResolvedValue({
      jti: "token-id",
      sid: "session-id",
      sub: user.id,
      tokenType: "access",
    });

    await expect(service.refresh("not-a-refresh-token")).rejects.toThrow(
      new UnauthorizedException("Сессия недействительна"),
    );
    expect(authSessionsService.rotate).not.toHaveBeenCalled();
  });
});
