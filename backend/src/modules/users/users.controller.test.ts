import type { INestApplication } from "@nestjs/common";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
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
  AUTH_TOKEN_ISSUER,
  JWT_ALGORITHM,
} from "../../common/const/auth.constants.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import { Role } from "../../generated/prisma/enums.js";
import { AuthSessionsService } from "../auth/auth-sessions.service.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { PasswordService } from "../auth/password.service.js";
import { UsersController } from "./users.controller.js";
import { UsersService } from "./users.service.js";

const ACCESS_SECRET = "test-access-secret-with-at-least-32-characters";

function isHttpServer(value: unknown): value is Server {
  return value instanceof Server;
}

describe("UsersController", () => {
  const admin = {
    id: "8c15a0d2-4328-4d6d-8426-49f10b0f679c",
    login: "admin",
    role: Role.ADMINISTRATOR,
    lastName: "Администраторов",
    firstName: "Администратор",
    patronymic: null,
    phone: null,
    email: null,
    createdAt: new Date("2026-09-15T12:00:00.000Z"),
  };
  const inspector = {
    ...admin,
    id: "5f6b53f0-5b52-4f2f-9e8a-2a3a5b2e6a3b",
    login: "inspector.ivanov",
    role: Role.INSPECTOR,
    lastName: "Иванов",
    firstName: "Иван",
  };
  const usersService = {
    create: vi.fn(),
    findById: vi.fn(),
    findCredentialsByLogin: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
  };
  const authSessionsService = {
    isActive: vi.fn(),
  };
  const passwordService = {
    hash: vi.fn(),
  };
  const configService = {
    get: (key: string) => ({ JWT_SECRET: ACCESS_SECRET })[key],
    getOrThrow: (key: string) => {
      const value = { JWT_SECRET: ACCESS_SECRET }[key];

      if (value === undefined) {
        throw new Error(`Missing test config: ${key}`);
      }

      return value;
    },
  };

  let app: INestApplication;
  let httpServer: Server;
  let jwtService: JwtService;

  async function signAccessToken(userId: string): Promise<string> {
    return jwtService.signAsync(
      {
        jti: "token-id",
        sid: "session-id",
        sub: userId,
        tokenType: "access",
      },
      {
        algorithm: JWT_ALGORITHM,
        audience: ACCESS_TOKEN_AUDIENCE,
        issuer: AUTH_TOKEN_ISSUER,
        secret: ACCESS_SECRET,
      },
    );
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      controllers: [UsersController],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: AuthSessionsService, useValue: authSessionsService },
        { provide: ConfigService, useValue: configService },
        { provide: PasswordService, useValue: passwordService },
        { provide: UsersService, useValue: usersService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
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
    authSessionsService.isActive.mockResolvedValue(true);
    usersService.findById.mockResolvedValue(admin);
  });

  afterAll(async () => {
    await app.close();
  });

  it("защищает список пользователей от запроса без access token", async () => {
    await request(httpServer).get("/v1/admin/users").expect(401);
  });

  it("не отдаёт список пользователей инспектору", async () => {
    usersService.findById.mockResolvedValue(inspector);
    const token = await signAccessToken(inspector.id);

    await request(httpServer)
      .get("/v1/admin/users")
      .auth(token, { type: "bearer" })
      .expect(403);

    expect(usersService.list).not.toHaveBeenCalled();
  });

  it("возвращает список пользователей администратору", async () => {
    usersService.list.mockResolvedValue([admin, inspector]);
    const token = await signAccessToken(admin.id);

    await request(httpServer)
      .get("/v1/admin/users")
      .auth(token, { type: "bearer" })
      .expect(200)
      .expect((response) => {
        expect(response.body).toHaveLength(2);
      });
  });

  it("создаёт пользователя с указанной ролью и хешированным паролем", async () => {
    usersService.findCredentialsByLogin.mockResolvedValue(null);
    usersService.create.mockResolvedValue(inspector);
    passwordService.hash.mockResolvedValue("scrypt-hash");
    const token = await signAccessToken(admin.id);

    await request(httpServer)
      .post("/v1/admin/users")
      .auth(token, { type: "bearer" })
      .send({
        login: "Inspector.Ivanov",
        password: "correct-horse-2026",
        lastName: " Иванов ",
        firstName: "Иван",
        role: "INSPECTOR",
      })
      .expect(201)
      .expect((response) => {
        expect(response.body.login).toBe("inspector.ivanov");
      });

    expect(passwordService.hash).toHaveBeenCalledWith("correct-horse-2026");
    expect(usersService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        login: "inspector.ivanov",
        lastName: "Иванов",
        firstName: "Иван",
        role: "INSPECTOR",
        passwordHash: "scrypt-hash",
      }),
    );
  });

  it("отклоняет создание пользователя без фамилии и имени", async () => {
    const token = await signAccessToken(admin.id);

    await request(httpServer)
      .post("/v1/admin/users")
      .auth(token, { type: "bearer" })
      .send({
        login: "inspector.ivanov",
        password: "correct-horse-2026",
        lastName: "  ",
      })
      .expect(400);

    expect(usersService.create).not.toHaveBeenCalled();
  });

  it("отклоняет создание пользователя с занятым логином", async () => {
    usersService.findCredentialsByLogin.mockResolvedValue(inspector);
    const token = await signAccessToken(admin.id);

    await request(httpServer)
      .post("/v1/admin/users")
      .auth(token, { type: "bearer" })
      .send({
        login: "inspector.ivanov",
        password: "correct-horse-2026",
        lastName: "Иванов",
        firstName: "Иван",
      })
      .expect(409);
  });

  it("обновляет данные и роль другого пользователя", async () => {
    usersService.update.mockResolvedValue({
      ...inspector,
      role: Role.ML_ENGINEER,
    });
    const token = await signAccessToken(admin.id);

    await request(httpServer)
      .patch(`/v1/admin/users/${inspector.id}`)
      .auth(token, { type: "bearer" })
      .send({ role: "ML_ENGINEER", phone: "+7 900 123-45-67" })
      .expect(200)
      .expect((response) => {
        expect(response.body.role).toBe("ML_ENGINEER");
      });

    expect(usersService.update).toHaveBeenCalledWith(
      inspector.id,
      expect.objectContaining({
        role: "ML_ENGINEER",
        phone: "+7 900 123-45-67",
      }),
    );
  });

  it("не позволяет администратору изменить собственную роль", async () => {
    const token = await signAccessToken(admin.id);

    await request(httpServer)
      .patch(`/v1/admin/users/${admin.id}`)
      .auth(token, { type: "bearer" })
      .send({ role: "INSPECTOR" })
      .expect(400);

    expect(usersService.update).not.toHaveBeenCalled();
  });

  it("не позволяет изменить логин или пароль через редактирование", async () => {
    const token = await signAccessToken(admin.id);

    await request(httpServer)
      .patch(`/v1/admin/users/${inspector.id}`)
      .auth(token, { type: "bearer" })
      .send({ login: "new-login", password: "new-password-2026" })
      .expect(400);

    expect(usersService.update).not.toHaveBeenCalled();
  });

  it("возвращает 404 при обновлении несуществующего пользователя", async () => {
    usersService.update.mockRejectedValue({ code: "P2025" });
    const token = await signAccessToken(admin.id);

    await request(httpServer)
      .patch("/v1/admin/users/5f6b53f0-5b52-4f2f-9e8a-2a3a5b2e6a3b")
      .auth(token, { type: "bearer" })
      .send({ firstName: "Пётр" })
      .expect(404);
  });
});
