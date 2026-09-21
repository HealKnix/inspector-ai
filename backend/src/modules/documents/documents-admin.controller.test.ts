import type { INestApplication } from "@nestjs/common";
import {
  ConflictException,
  NotFoundException,
  ValidationPipe,
} from "@nestjs/common";
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
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { AuthSessionsService } from "../auth/auth-sessions.service.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { ParsingService } from "../parsing/parsing.service.js";
import { UsersService } from "../users/users.service.js";
import { DocumentsAdminController } from "./documents-admin.controller.js";

const ACCESS_SECRET = "test-access-secret-with-at-least-32-characters";
const FILE_ID = "0f5d7c1e-3b6a-4b28-9e4f-2d1c8a7b6e5f";
const OBJECT_ID = "a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const UPLOADER_ID = "b2c3d4e5-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
const ARTIFACT_ID = "c3d4e5f6-7a8b-4c9d-ae1f-2a3b4c5d6e7f";

function isHttpServer(value: unknown): value is Server {
  return value instanceof Server;
}

const fileRow = {
  id: FILE_ID,
  objectId: OBJECT_ID,
  processId: "d4e5f6a7-8b9c-4d0e-1f2a-3b4c5d6e7f8a",
  runId: "e5f6a7b8-9c0d-4e1f-2a3b-4c5d6e7f8a9b",
  originalName: "Раздел_АР.pdf",
  format: "PDF",
  size: 1024,
  sha256: "a".repeat(64),
  createdAt: new Date("2026-09-20T10:00:00.000Z"),
  corruptedAt: null,
  object: { name: "ЖК «Северный»" },
  uploader: {
    id: UPLOADER_ID,
    login: "inspector.ivanov",
    lastName: "Иванов",
    firstName: "Иван",
    patronymic: null,
  },
  parsingTasks: [
    {
      state: "succeeded",
      pagesTotal: 12,
      errorCode: null,
      artifact: { id: ARTIFACT_ID },
    },
  ],
};

describe("DocumentsAdminController", () => {
  const admin = {
    id: "8c15a0d2-4328-4d6d-8426-49f10b0f679c",
    login: "admin",
    role: Role.ADMINISTRATOR,
  };
  const inspector = {
    ...admin,
    id: UPLOADER_ID,
    role: Role.INSPECTOR,
  };
  const prisma = {
    $transaction: vi.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
    file: { findMany: vi.fn(), count: vi.fn() },
  };
  const parsingService = {
    adminArtifact: vi.fn(),
    adminPage: vi.fn(),
  };
  const usersService = { findById: vi.fn() };
  const authSessionsService = { isActive: vi.fn() };
  const configService = {
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
      controllers: [DocumentsAdminController],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: AuthSessionsService, useValue: authSessionsService },
        { provide: ConfigService, useValue: configService },
        { provide: PrismaService, useValue: prisma },
        { provide: ParsingService, useValue: parsingService },
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
    prisma.file.findMany.mockResolvedValue([fileRow]);
    prisma.file.count.mockResolvedValue(1);
  });

  afterAll(async () => {
    await app.close();
  });

  it("защищает список документов от запроса без access token", async () => {
    await request(httpServer).get("/v1/admin/documents").expect(401);
  });

  it("не отдаёт список документов инспектору", async () => {
    usersService.findById.mockResolvedValue(inspector);
    const token = await signAccessToken(inspector.id);

    await request(httpServer)
      .get("/v1/admin/documents")
      .auth(token, { type: "bearer" })
      .expect(403);

    expect(prisma.file.findMany).not.toHaveBeenCalled();
  });

  it("возвращает администратору документы с владельцем и состоянием парсинга", async () => {
    const token = await signAccessToken(admin.id);

    await request(httpServer)
      .get("/v1/admin/documents")
      .auth(token, { type: "bearer" })
      .expect(200)
      .expect((response) => {
        expect(response.body.total).toBe(1);
        expect(response.body.items[0]).toMatchObject({
          id: FILE_ID,
          object_name: "ЖК «Северный»",
          integrity_error: false,
          uploaded_by: { login: "inspector.ivanov", last_name: "Иванов" },
          parsing: { state: "succeeded", artifact_id: ARTIFACT_ID },
        });
      });
  });

  it("передаёт фильтры по пользователю и объекту в запрос", async () => {
    const token = await signAccessToken(admin.id);

    await request(httpServer)
      .get(
        `/v1/admin/documents?user_id=${UPLOADER_ID}&object_id=${OBJECT_ID}&page=2`,
      )
      .auth(token, { type: "bearer" })
      .expect(200);

    expect(prisma.file.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { uploadedBy: UPLOADER_ID, objectId: OBJECT_ID },
        skip: 20,
      }),
    );
    expect(prisma.file.count).toHaveBeenCalledWith({
      where: { uploadedBy: UPLOADER_ID, objectId: OBJECT_ID },
    });
  });

  it("передаёт поисковый запрос в OR-фильтр по файлу, объекту и пользователю", async () => {
    const token = await signAccessToken(admin.id);

    await request(httpServer)
      .get("/v1/admin/documents?q=  Иванов  ")
      .auth(token, { type: "bearer" })
      .expect(200);

    expect(prisma.file.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { originalName: { contains: "Иванов", mode: "insensitive" } },
            { object: { name: { contains: "Иванов", mode: "insensitive" } } },
            {
              uploader: {
                OR: [
                  { login: { contains: "Иванов", mode: "insensitive" } },
                  { lastName: { contains: "Иванов", mode: "insensitive" } },
                  { firstName: { contains: "Иванов", mode: "insensitive" } },
                ],
              },
            },
          ],
        },
      }),
    );
    expect(prisma.file.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ OR: expect.any(Array) }),
      }),
    );
  });

  it("отклоняет фильтры с не-uuid значениями", async () => {
    const token = await signAccessToken(admin.id);

    await request(httpServer)
      .get("/v1/admin/documents?user_id=not-a-uuid")
      .auth(token, { type: "bearer" })
      .expect(400);

    expect(prisma.file.findMany).not.toHaveBeenCalled();
  });

  it("отдаёт проверенный артефакт администратору", async () => {
    parsingService.adminArtifact.mockResolvedValue({
      artifact_id: ARTIFACT_ID,
      file_id: FILE_ID,
      run_id: fileRow.runId,
      artifact: { schema_version: 1, pages: [] },
    });
    const token = await signAccessToken(admin.id);

    await request(httpServer)
      .get(`/v1/admin/documents/${FILE_ID}/parse`)
      .auth(token, { type: "bearer" })
      .expect(200)
      .expect((response) => {
        expect(response.body.artifact_id).toBe(ARTIFACT_ID);
        expect(response.headers["cache-control"]).toContain("no-store");
      });

    expect(parsingService.adminArtifact).toHaveBeenCalledWith(FILE_ID);
  });

  it("возвращает 404 для отсутствующего файла", async () => {
    parsingService.adminArtifact.mockRejectedValue(
      new NotFoundException("Файл недоступен"),
    );
    const token = await signAccessToken(admin.id);

    await request(httpServer)
      .get(`/v1/admin/documents/${FILE_ID}/parse`)
      .auth(token, { type: "bearer" })
      .expect(404);
  });

  it("возвращает 409, если опубликованный результат изменился", async () => {
    parsingService.adminArtifact.mockRejectedValue(
      new ConflictException(
        "Результат текущего запуска ещё недоступен или изменился",
      ),
    );
    const token = await signAccessToken(admin.id);

    await request(httpServer)
      .get(`/v1/admin/documents/${FILE_ID}/parse`)
      .auth(token, { type: "bearer" })
      .expect(409);
  });

  it("отдаёт PNG страницы с идентификатором артефакта", async () => {
    parsingService.adminPage.mockResolvedValue({
      bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      artifactId: ARTIFACT_ID,
    });
    const token = await signAccessToken(admin.id);

    await request(httpServer)
      .get(`/v1/admin/documents/${FILE_ID}/parse/pages/2`)
      .auth(token, { type: "bearer" })
      .expect(200)
      .expect("Content-Type", /image\/png/)
      .expect("X-Artifact-Id", ARTIFACT_ID);

    expect(parsingService.adminPage).toHaveBeenCalledWith(
      FILE_ID,
      2,
      undefined,
    );
  });

  it("передаёт expected artifact_id при запросе страницы", async () => {
    parsingService.adminPage.mockResolvedValue({
      bytes: Buffer.from([0x89]),
      artifactId: ARTIFACT_ID,
    });
    const token = await signAccessToken(admin.id);

    await request(httpServer)
      .get(
        `/v1/admin/documents/${FILE_ID}/parse/pages/1?artifact_id=${ARTIFACT_ID}`,
      )
      .auth(token, { type: "bearer" })
      .expect(200);

    expect(parsingService.adminPage).toHaveBeenCalledWith(
      FILE_ID,
      1,
      ARTIFACT_ID,
    );
  });
});
