import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { IsOptional, IsUUID } from "class-validator";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import { type AuthenticatedRequest } from "../auth/jwt-auth.guard.js";
import { apiErrorSchema } from "../documents/upload-contract.js";
import { parseArtifactSchema } from "./parsing-openapi.js";
import { PARSING_PHASES } from "./parsing-progress.js";
import { ParsingService } from "./parsing.service.js";

export class ParsingRetryDto {
  @ApiProperty({
    format: "uuid",
    description: "Идемпотентный идентификатор намерения повтора",
  })
  @IsUUID()
  request_id!: string;
}
export class ParsingPageQueryDto {
  @ApiProperty({
    format: "uuid",
    required: false,
    description: "Артефакт, которому принадлежит геометрия; 409 при смене",
  })
  @IsOptional()
  @IsUUID()
  artifact_id?: string;
}

@ApiTags("parsing")
@ApiBearerAuth("access-token")
@ApiResponse({
  status: 401,
  schema: apiErrorSchema,
  description: "Недействительная сессия",
})
@ApiResponse({
  status: 403,
  schema: apiErrorSchema,
  description: "Нет назначения инспектора на объект",
})
@ApiResponse({
  status: 409,
  schema: apiErrorSchema,
  description:
    "Нет результата текущего Run, результат изменился или повтор недоступен",
})
@ApiResponse({
  status: 503,
  schema: apiErrorSchema,
  description: "Сохранённый результат недоступен или повреждён",
})
@Controller("v1/objects/:objectId")
export class ParsingController {
  constructor(private readonly parsing: ParsingService) {}
  @Get("parsing")
  @ApiResponse({
    status: 200,
    description:
      "Технические состояния файлов последних Run; окончание OCR не означает READY",
    schema: {
      type: "object",
      required: ["schema_version", "active", "poll_after_ms", "items"],
      properties: {
        schema_version: { type: "integer", enum: [1] },
        active: { type: "boolean" },
        poll_after_ms: { type: "integer", enum: [2000] },
        items: {
          type: "array",
          items: {
            type: "object",
            required: [
              "file_id",
              "process_id",
              "run_id",
              "original_name",
              "state",
              "attempt",
              "pages_completed",
              "pages_total",
              "quality",
              "reasons",
              "error_code",
              "can_retry",
              "artifact_id",
              "phase",
              "progress_updated_at",
              "waiting_reason",
              "retry_at",
              "checkpoint_validated",
              "checkpoint_pages",
              "current_page",
              "previous_attempt_error",
              "progress_reset_reason",
            ],
            properties: {
              file_id: { type: "string", format: "uuid" },
              process_id: { type: "string", format: "uuid" },
              run_id: { type: "string", format: "uuid" },
              original_name: { type: "string" },
              state: {
                type: "string",
                enum: ["queued", "processing", "succeeded", "failed"],
              },
              attempt: { type: "integer", minimum: 0, maximum: 3 },
              pages_completed: { type: "integer", minimum: 0 },
              pages_total: { type: "integer", nullable: true },
              quality: {
                type: "string",
                enum: ["OK", "LOW_QUALITY", "ABSTAIN"],
                nullable: true,
              },
              reasons: { type: "array", items: { type: "string" } },
              error_code: { type: "string", nullable: true },
              can_retry: { type: "boolean" },
              artifact_id: { type: "string", format: "uuid", nullable: true },
              progress_reset_reason: {
                type: "string",
                enum: ["pipeline_version_changed", "saved_pages_unavailable"],
                nullable: true,
                description:
                  "Почему предыдущие счётчики страниц не описывают текущую обработку; это не оценка качества документа",
              },
              phase: {
                type: "string",
                enum: [...PARSING_PHASES],
                nullable: true,
                description:
                  "Технический этап; NULL у исторических задач и завершённых исходов",
              },
              progress_updated_at: {
                type: "string",
                format: "date-time",
                nullable: true,
                description:
                  "Время последнего подтверждённого обновления счётчиков страниц",
              },
              waiting_reason: {
                type: "string",
                enum: ["models_not_ready", "parser_busy", "retry_backoff"],
                nullable: true,
              },
              retry_at: {
                type: "string",
                format: "date-time",
                nullable: true,
                description:
                  "Не раньше этого времени задача может быть повторно взята из очереди; не обещание времени старта",
              },
              checkpoint_validated: {
                type: "boolean",
                nullable: true,
                description:
                  "Проверены ли checkpoints текущей попытки; false сохраняет предыдущие счётчики только как последний известный прогресс",
              },
              checkpoint_pages: {
                type: "integer",
                minimum: 0,
                nullable: true,
                description:
                  "Последнее подтверждённое число годных checkpoints PDF; NULL для обработки без возобновления по страницам",
              },
              current_page: {
                type: "integer",
                minimum: 1,
                nullable: true,
                description:
                  "Текущая физическая страница; не счётчик завершённых страниц",
              },
              previous_attempt_error: {
                type: "string",
                nullable: true,
                description:
                  "Последняя ошибка реальной попытки; ожидание готовности её не заменяет",
              },
            },
          },
        },
      },
    },
  })
  list(
    @Req() request: AuthenticatedRequest,
    @Param("objectId", ParseUUIDPipe) objectId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "private, no-store");
    return this.parsing.list(request.user.id, objectId);
  }
  @Get("files/:fileId/parse")
  @ApiResponse({
    status: 200,
    description:
      "Проверенный ParseArtifact v1 текущего Run с текстом, страницами и локаторами",
    schema: {
      type: "object",
      required: ["artifact_id", "file_id", "run_id", "artifact"],
      properties: {
        artifact_id: { type: "string", format: "uuid" },
        file_id: { type: "string", format: "uuid" },
        run_id: { type: "string", format: "uuid" },
        artifact: parseArtifactSchema,
      },
    },
  })
  artifact(
    @Req() request: AuthenticatedRequest,
    @Param("objectId", ParseUUIDPipe) objectId: string,
    @Param("fileId", ParseUUIDPipe) fileId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "private, no-store");
    return this.parsing.artifact(request.user.id, objectId, fileId);
  }
  @Get("files/:fileId/parse/pages/:pageNumber")
  @ApiResponse({
    status: 200,
    description:
      "PNG именно опубликованного артефакта; X-Artifact-Id связывает страницу с геометрией",
    content: { "image/png": { schema: { type: "string", format: "binary" } } },
  })
  async page(
    @Req() request: AuthenticatedRequest,
    @Param("objectId", ParseUUIDPipe) objectId: string,
    @Param("fileId", ParseUUIDPipe) fileId: string,
    @Param("pageNumber", ParseIntPipe) pageNumber: number,
    @Query() query: ParsingPageQueryDto,
    @Res() response: Response,
  ) {
    const page = await this.parsing.page(
      request.user.id,
      objectId,
      fileId,
      pageNumber,
      query.artifact_id,
    );
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Type", "image/png");
    response.setHeader("X-Artifact-Id", page.artifactId);
    response.send(page.bytes);
  }
  @Post("files/:fileId/parse/retry")
  @HttpCode(202)
  @ApiResponse({
    status: 202,
    description:
      "Новый ограниченный цикл зарегистрирован; replay request_id не создаёт новый цикл",
    schema: {
      type: "object",
      required: ["request_id", "task_id"],
      properties: {
        request_id: { type: "string", format: "uuid" },
        task_id: { type: "string", format: "uuid" },
      },
    },
  })
  retry(
    @Req() request: AuthenticatedRequest,
    @Param("objectId", ParseUUIDPipe) objectId: string,
    @Param("fileId", ParseUUIDPipe) fileId: string,
    @Body() body: ParsingRetryDto,
  ) {
    return this.parsing.retry(
      { userId: request.user.id, ip: request.ip, requestId: randomUUID() },
      objectId,
      fileId,
      body.request_id,
    );
  }
}
