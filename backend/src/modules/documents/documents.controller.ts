import {
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { PrivateStorageService } from "../../infrastructure/storage/private-storage.service.js";
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from "../auth/jwt-auth.guard.js";
import { ObjectAccessService } from "../objects/object-access.service.js";
import { PageQueryDto } from "../objects/objects.dto.js";
import { DocumentAdmissionService } from "./document-admission.service.js";
import { FileListDto, ProcessDto } from "./documents.dto.js";
import {
  apiErrorSchema,
  mixedExample,
  rejectedExample,
  uploadRequestSchema,
  uploadResponseSchema,
} from "./upload-contract.js";
import { receiveUpload } from "./upload-stream.js";

@ApiTags("documents")
@ApiBearerAuth("access-token")
@ApiResponse({
  status: 401,
  schema: apiErrorSchema,
  description: "Недействительная сессия",
})
@ApiResponse({
  status: 403,
  schema: {
    ...apiErrorSchema,
    example: {
      statusCode: 403,
      message: "Объект недоступен",
      error: "Forbidden",
    },
  },
})
@ApiResponse({
  status: 404,
  schema: apiErrorSchema,
  description: "Файл или подтверждение приёма не найдено",
})
@UseGuards(JwtAuthGuard)
@Controller("v1")
export class DocumentsController {
  private readonly logger = new Logger(DocumentsController.name);
  constructor(
    private readonly admission: DocumentAdmissionService,
    private readonly storage: PrivateStorageService,
    private readonly prisma: PrismaService,
    private readonly access: ObjectAccessService,
  ) {}

  @Post("documents/upload")
  @ApiConsumes("application/json")
  @ApiBody({ schema: uploadRequestSchema })
  @ApiResponse({
    status: 202,
    description:
      "Оригиналы сохранены, намерение обработки зарегистрировано; анализ ещё не выполнен",
    schema: { ...uploadResponseSchema, example: mixedExample },
  })
  @ApiResponse({
    status: 422,
    description:
      "Новых файлов нет: дубли (duplicate_file, existing_file_id) или отказы; process_id/run_id равны null",
    schema: { ...uploadResponseSchema, example: rejectedExample },
  })
  @ApiResponse({
    status: 400,
    schema: apiErrorSchema,
    description:
      "Некорректный JSON/base64, отсутствующий object_id или оборванная передача",
  })
  @ApiResponse({
    status: 409,
    schema: apiErrorSchema,
    description: "Конфликт ключа, объекта процесса или состояния процесса",
  })
  @ApiResponse({
    status: 413,
    schema: apiErrorSchema,
    description: "Лимит пакета 200 МБ превышен; ни один файл не принят",
  })
  @ApiResponse({
    status: 503,
    schema: apiErrorSchema,
    description:
      "Приём временно недоступен; проверьте receipt и повторите с тем же ключом",
  })
  async upload(
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
  ) {
    if (!request.is("application/json") || request.headers["content-encoding"])
      throw new UnsupportedMediaTypeException(
        "Требуется несжатый application/json",
      );
    await this.prisma.$transaction((tx) =>
      this.access.requireInspector(tx, request.user.id),
    );
    const started = Date.now();
    const requestId = randomUUID();
    const deadline = started + 600_000;
    const upload = await receiveUpload(
      request,
      this.storage,
      AbortSignal.timeout(600_000),
    );
    try {
      const result = await this.admission.accept(
        { userId: request.user.id, ip: request.ip, requestId },
        upload,
        deadline,
        request.authSessionId,
      );
      this.logger.log(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "INFO",
          service: "ingestion",
          message: "documents.admission.finished",
          request_id: requestId,
          user_id: request.user.id,
          object_id: upload.object_id,
          http_status: result.httpStatus,
          decoded_bytes: upload.files.reduce(
            (total, file) => total + file.size,
            0,
          ),
          duration_ms: Date.now() - started,
        }),
      );
      response.status(result.httpStatus).json(result.response);
    } catch (error) {
      this.logger.warn(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          level: "WARNING",
          service: "ingestion",
          message: "documents.admission.failed",
          request_id: requestId,
          user_id: request.user.id,
          object_id: upload.object_id,
          http_status: error instanceof HttpException ? error.getStatus() : 503,
        }),
      );
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        "Приём временно недоступен. Проверьте подтверждение и повторите запрос с тем же ключом.",
      );
    } finally {
      await Promise.all(
        upload.files.map((file) => this.storage.discard(file.key)),
      );
    }
  }

  @Get("objects/:objectId/uploads/:uploadId")
  @ApiResponse({ status: 200, schema: uploadResponseSchema })
  async receipt(
    @Req() request: AuthenticatedRequest,
    @Param("objectId", ParseUUIDPipe) objectId: string,
    @Param("uploadId", ParseUUIDPipe) clientUploadId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, request.user.id, objectId);
      const receipt = await tx.uploadReceipt.findUnique({
        where: {
          userId_objectId_clientUploadId: {
            userId: request.user.id,
            objectId,
            clientUploadId,
          },
        },
      });
      if (!receipt)
        throw new NotFoundException("Подтверждение приёма ещё не найдено");
      return receipt.response;
    });
  }

  @Get("objects/:objectId/files")
  @ApiResponse({
    status: 200,
    type: FileListDto,
    description:
      "Постраничный реестр оригиналов выбранного объекта; total учитывает весь реестр",
  })
  async files(
    @Req() request: AuthenticatedRequest,
    @Param("objectId", ParseUUIDPipe) objectId: string,
    @Query() query: PageQueryDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, request.user.id, objectId);
      const items = await tx.file.findMany({
        where: { objectId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
      return {
        items: items.map((file) => ({
          id: file.id,
          object_id: objectId,
          process_id: file.processId,
          run_id: file.runId,
          original_name: file.originalName,
          size: file.size,
          format: file.format,
          sha256: file.sha256,
          created_at: file.createdAt.toISOString(),
          integrity_error: file.corruptedAt !== null,
        })),
        total: await tx.file.count({ where: { objectId } }),
        page: query.page,
        limit: query.limit,
      };
    });
  }

  @Get("processes/:processId")
  @ApiResponse({
    status: 200,
    type: ProcessDto,
    description:
      "Долговечное состояние процесса и последний запуск. PENDING не означает выполненный анализ.",
  })
  async process(
    @Req() request: AuthenticatedRequest,
    @Param("processId", ParseUUIDPipe) processId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const owner = await tx.process.findUnique({
        where: { id: processId },
        select: { objectId: true },
      });
      if (!owner) throw new ForbiddenException("Процесс недоступен");
      await this.access.lock(tx, owner.objectId);
      await this.access.requireAccess(tx, request.user.id, owner.objectId);
      await tx.$queryRaw`SELECT id FROM processes WHERE id = ${processId}::uuid FOR SHARE`;
      const process = await tx.process.findUniqueOrThrow({
        where: { id: processId },
      });
      const run = await tx.run.findFirst({
        where: { processId },
        orderBy: { version: "desc" },
        select: { id: true, inputManifestHash: true },
      });
      return {
        schema_version: 1,
        object_id: process.objectId,
        process_id: process.id,
        status: process.status,
        run_id: run?.id ?? null,
        input_manifest_hash: run?.inputManifestHash ?? null,
        allowed_actions: [
          "PENDING",
          "READY",
          "VERIFYING",
          "COMPLETED",
        ].includes(process.status)
          ? ["upload"]
          : [],
      };
    });
  }

  @Get("objects/:objectId/files/:fileId/original")
  @ApiResponse({
    status: 200,
    description:
      "Неизменяемые исходные байты, скачивание только после проверки назначения",
    content: {
      "application/octet-stream": {
        schema: { type: "string", format: "binary" },
      },
    },
  })
  async original(
    @Req() request: AuthenticatedRequest,
    @Res() response: Response,
    @Param("objectId", ParseUUIDPipe) objectId: string,
    @Param("fileId", ParseUUIDPipe) fileId: string,
  ) {
    const file = await this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, request.user.id, objectId);
      const found = await tx.file.findFirst({
        where: { id: fileId, objectId },
      });
      if (!found) throw new NotFoundException("Файл недоступен");
      return found;
    });
    if (file.corruptedAt)
      throw new ServiceUnavailableException("Нарушена целостность оригинала");
    response.setHeader("Content-Type", "application/octet-stream");
    response.setHeader(
      "Content-Disposition",
      "attachment; filename=original; filename*=UTF-8''" +
        encodeURIComponent(file.originalName).replace(
          /['()*]/g,
          (char) => "%" + char.charCodeAt(0).toString(16),
        ),
    );
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Length", file.size);
    await pipeline(this.storage.read(file.storageKey), response);
  }
}
