import type { INestApplication } from "@nestjs/common";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import cookieParser from "cookie-parser";
import { Server } from "node:http";
import request from "supertest";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  ACCESS_TOKEN_AUDIENCE,
  AUTH_REQUEST_HEADER,
  AUTH_REQUEST_HEADER_VALUE,
  AUTH_TOKEN_ISSUER,
  JWT_ALGORITHM,
  REFRESH_TOKEN_COOKIE_NAME,
} from "../../common/const/auth.constants.js";
import { Role } from "../../generated/prisma/enums.js";
import { UsersService } from "../users/users.service.js";
import { AuthRequestGuard } from "./auth-request.guard.js";
import { AuthSessionsService } from "./auth-sessions.service.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { JwtAuthGuard } from "./jwt-auth.guard.js";

const ACCESS_SECRET = "test-access-secret-with-at-least-32-characters";
const REFRESH_SECRET = "test-refresh-secret-with-at-least-32-characters";
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;

function isHttpServer(value: unknown): value is Server {
  return value instanceof Server;
}

describe("AuthController", () => {
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
  const session = {
    accessToken: "signed-access-token",
    refreshToken: "signed-refresh-token",
    user,
  };
  const authService = {
    login: vi.fn(),
    logout: vi.fn(),
    refresh: vi.fn(),
    register: vi.fn(),
  };
  const authSessionsService = {
    isActive: vi.fn(),
  };
  const usersService = {
    findById: vi.fn(),
  };
  let nodeEnvironment = "test";
  const configValues: Record<string, unknown> = {
    JWT_REFRESH_SECRET: REFRESH_SECRET,
    JWT_REFRESH_TTL_SECONDS: REFRESH_TTL_SECONDS,
    JWT_SECRET: ACCESS_SECRET,
  };
  const configService = {
    get: (key: string) =>
      key === "NODE_ENV" ? nodeEnvironment : configValues[key],
    getOrThrow: (key: string) => {
      const value = key === "NODE_ENV" ? nodeEnvironment : configValues[key];

      if (value === undefined) {
        throw new Error(`Missing test config: ${key}`);
      }

      return value;
    },
  };

  let app: INestApplication;
  let httpServer: Server;
  let jwtService: JwtService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({}),
        ThrottlerModule.forRoot([{ limit: 120, ttl: 60_000 }]),
      ],
      controllers: [AuthController],
      providers: [
        AuthRequestGuard,
        JwtAuthGuard,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: AuthService, useValue: authService },
        { provide: AuthSessionsService, useValue: authSessionsService },
        { provide: ConfigService, useValue: configService },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        forbidNonWhitelisted: true,
        transform: true,
        whitelist: true,
      }),
    );
    await app.init();
    const rawHttpServer: unknown = app.getHttpServer();

    if (!isHttpServer(rawHttpServer)) {
      throw new TypeError(
        "Nest test application did not create an HTTP server",
      );
    }

    httpServer = rawHttpServer;
    jwtService = moduleRef.get(JwtService);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    nodeEnvironment = "test";
    authSessionsService.isActive.mockResolvedValue(true);
    usersService.findById.mockResolvedValue(user);
  });

  afterAll(async () => {
    await app.close();
  });

  it("возвращает access token и устанавливает refresh token в HttpOnly cookie", async () => {
    authService.register.mockResolvedValue(session);

    await request(httpServer)
      .post("/auth/register")
      .set(AUTH_REQUEST_HEADER, AUTH_REQUEST_HEADER_VALUE)
      .send({
        login: "Inspector.Ivanov",
        password: "correct-horse-2026",
        lastName: "Иванов",
        firstName: "Иван",
      })
      .expect(201)
      .expect(
        "set-cookie",
        /inspector_refresh_token=signed-refresh-token;.*Path=\/api\/auth;.*HttpOnly;.*SameSite=Lax/i,
      )
      .expect({
        accessToken: session.accessToken,
        user: { ...user, createdAt: user.createdAt.toISOString() },
      });

    expect(authService.register).toHaveBeenCalledWith(
      expect.objectContaining({
        login: "inspector.ivanov",
        password: "correct-horse-2026",
        lastName: "Иванов",
        firstName: "Иван",
      }),
    );
  });

  it("не позволяет назначить роль через публичную регистрацию", async () => {
    await request(httpServer)
      .post("/auth/register")
      .set(AUTH_REQUEST_HEADER, AUTH_REQUEST_HEADER_VALUE)
      .send({
        login: "Inspector.Ivanov",
        password: "correct-horse-2026",
        role: Role.ADMINISTRATOR,
      })
      .expect(400);

    expect(authService.register).not.toHaveBeenCalled();
  });

  it("добавляет Secure к refresh cookie в production", async () => {
    nodeEnvironment = "production";
    authService.login.mockResolvedValue(session);

    await request(httpServer)
      .post("/auth/login")
      .set(AUTH_REQUEST_HEADER, AUTH_REQUEST_HEADER_VALUE)
      .send({ login: "inspector.ivanov", password: "correct-horse-2026" })
      .expect(200)
      .expect(
        "set-cookie",
        /inspector_refresh_token=.*HttpOnly;.*Secure;.*SameSite=Lax/i,
      );
  });

  it("отклоняет изменяющий сессию запрос без защитного заголовка", async () => {
    await request(httpServer)
      .post("/auth/register")
      .send({ login: "inspector.ivanov", password: "correct-horse-2026" })
      .expect(403);
  });

  it("защищает профиль от запроса без Bearer access token", async () => {
    await request(httpServer).get("/auth/me").expect(401);
  });

  it("отклоняет Bearer JWT с неверным типом токена", async () => {
    const token = await jwtService.signAsync(
      {
        jti: "token-id",
        sid: "session-id",
        sub: user.id,
        tokenType: "refresh",
      },
      {
        algorithm: JWT_ALGORITHM,
        audience: ACCESS_TOKEN_AUDIENCE,
        issuer: AUTH_TOKEN_ISSUER,
        secret: ACCESS_SECRET,
      },
    );

    await request(httpServer)
      .get("/auth/me")
      .auth(token, { type: "bearer" })
      .expect(401);
  });

  it("возвращает пользователя по валидному Bearer access token", async () => {
    const token = await jwtService.signAsync(
      {
        jti: "token-id",
        sid: "session-id",
        sub: user.id,
        tokenType: "access",
      },
      {
        algorithm: JWT_ALGORITHM,
        audience: ACCESS_TOKEN_AUDIENCE,
        issuer: AUTH_TOKEN_ISSUER,
        secret: ACCESS_SECRET,
      },
    );

    await request(httpServer)
      .get("/auth/me")
      .auth(token, { type: "bearer" })
      .expect(200)
      .expect({ user: { ...user, createdAt: user.createdAt.toISOString() } });
    expect(usersService.findById).toHaveBeenCalledWith(user.id);
  });

  it("отклоняет access token удалённого пользователя", async () => {
    usersService.findById.mockResolvedValue(null);
    const token = await jwtService.signAsync(
      {
        jti: "token-id",
        sid: "session-id",
        sub: user.id,
        tokenType: "access",
      },
      {
        algorithm: JWT_ALGORITHM,
        audience: ACCESS_TOKEN_AUDIENCE,
        issuer: AUTH_TOKEN_ISSUER,
        secret: ACCESS_SECRET,
      },
    );

    await request(httpServer)
      .get("/auth/me")
      .auth(token, { type: "bearer" })
      .expect(401);
  });

  it("отклоняет access token от отозванной серверной сессии", async () => {
    authSessionsService.isActive.mockResolvedValue(false);
    const token = await jwtService.signAsync(
      {
        jti: "token-id",
        sid: "revoked-session-id",
        sub: user.id,
        tokenType: "access",
      },
      {
        algorithm: JWT_ALGORITHM,
        audience: ACCESS_TOKEN_AUDIENCE,
        issuer: AUTH_TOKEN_ISSUER,
        secret: ACCESS_SECRET,
      },
    );

    await request(httpServer)
      .get("/auth/me")
      .auth(token, { type: "bearer" })
      .expect(401);
    expect(usersService.findById).not.toHaveBeenCalled();
  });

  it("ротирует refresh token и возвращает новый access token", async () => {
    const rotatedSession = {
      ...session,
      accessToken: "rotated-access-token",
      refreshToken: "rotated-refresh-token",
    };
    authService.refresh.mockResolvedValue(rotatedSession);

    await request(httpServer)
      .post("/auth/refresh")
      .set(AUTH_REQUEST_HEADER, AUTH_REQUEST_HEADER_VALUE)
      .set("Cookie", `${REFRESH_TOKEN_COOKIE_NAME}=current-refresh-token`)
      .expect(200)
      .expect("set-cookie", /inspector_refresh_token=rotated-refresh-token/i)
      .expect({
        accessToken: rotatedSession.accessToken,
        user: { ...user, createdAt: user.createdAt.toISOString() },
      });

    expect(authService.refresh).toHaveBeenCalledWith("current-refresh-token");
  });

  it("отзывает refresh-сессию и очищает cookie при выходе", async () => {
    authService.logout.mockResolvedValue(undefined);

    await request(httpServer)
      .post("/auth/logout")
      .set(AUTH_REQUEST_HEADER, AUTH_REQUEST_HEADER_VALUE)
      .set("Cookie", `${REFRESH_TOKEN_COOKIE_NAME}=current-refresh-token`)
      .expect(204)
      .expect(
        "set-cookie",
        /inspector_refresh_token=;.*Path=\/api\/auth;.*Expires=.*1970.*HttpOnly;.*SameSite=Lax/i,
      );

    expect(authService.logout).toHaveBeenCalledWith("current-refresh-token");
  });
});
