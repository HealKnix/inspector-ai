import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard.js";
import {
  clarificationRequestSchema,
  clarificationResponseSchema,
  identificationRegistrySchema,
} from "./identification-openapi.js";
import { IdentificationService } from "./identification.service.js";

@ApiTags("identification")
@ApiBearerAuth("access-token")
@Controller("v1/processes/:processId")
export class IdentificationController {
  constructor(private readonly identification: IdentificationService) {}

  @Get("documents")
  @ApiQuery({ name: "run_id", required: false, format: "uuid" })
  @ApiQuery({
    name: "resolved_input_hash",
    required: false,
    schema: { type: "string", pattern: "^[a-f0-9]{64}$" },
  })
  @ApiResponse({
    status: 200,
    schema: identificationRegistrySchema,
    description:
      "Реестр логических документов и неизменяемый снимок выбранного запуска",
  })
  list(
    @Req() request: AuthenticatedRequest,
    @Param("processId", ParseUUIDPipe) processId: string,
    @Query("run_id", new ParseUUIDPipe({ optional: true }))
    runId: string | undefined,
    @Query("resolved_input_hash") resolvedHash: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "private, no-store");
    return this.identification.list(
      request.user.id,
      processId,
      runId,
      undefined,
      resolvedHash,
    );
  }

  @Get("documents/:documentId")
  @ApiQuery({ name: "run_id", required: false, format: "uuid" })
  @ApiQuery({
    name: "resolved_input_hash",
    required: false,
    schema: { type: "string", pattern: "^[a-f0-9]{64}$" },
  })
  @ApiResponse({
    status: 200,
    schema: identificationRegistrySchema,
    description:
      "Реквизиты, машинные кандидаты, редакции и основания выбранного документа",
  })
  document(
    @Req() request: AuthenticatedRequest,
    @Param("processId", ParseUUIDPipe) processId: string,
    @Param("documentId", ParseUUIDPipe) documentId: string,
    @Query("run_id", new ParseUUIDPipe({ optional: true }))
    runId: string | undefined,
    @Query("resolved_input_hash") resolvedHash: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "private, no-store");
    return this.identification.list(
      request.user.id,
      processId,
      runId,
      documentId,
      resolvedHash,
    );
  }

  @Post("document-resolutions")
  @HttpCode(202)
  @ApiBody({ schema: clarificationRequestSchema })
  @ApiResponse({
    status: 202,
    schema: clarificationResponseSchema,
    description:
      "Уточнения сохранены атомарно; новый Run сохраняет историю и переиспользует совместимые артефакты",
  })
  @ApiResponse({
    status: 409,
    description:
      "Запуск/карточка изменились, выполняется обработка либо процесс закрыт для изменения",
  })
  apply(
    @Req() request: AuthenticatedRequest,
    @Param("processId", ParseUUIDPipe) processId: string,
    @Body() body: unknown,
  ) {
    return this.identification.apply(
      { userId: request.user.id, requestId: randomUUID(), ip: request.ip },
      processId,
      body,
    );
  }
}
