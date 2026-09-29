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
import { apiErrorSchema } from "../documents/upload-contract.js";
import { SectionAnalysisService } from "./section-analysis.service.js";

const sectionAnalysisRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["request_id", "expected_run_id"],
  properties: {
    request_id: { type: "string", format: "uuid" },
    expected_run_id: { type: "string", format: "uuid" },
    parameter_codes: {
      type: "array",
      maxItems: 132,
      items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$" },
    },
  },
};

@ApiTags("section-analysis")
@ApiBearerAuth("access-token")
@ApiResponse({ status: 401, schema: apiErrorSchema })
@ApiResponse({ status: 403, schema: apiErrorSchema })
@Controller("v1/objects/:objectId")
export class SectionAnalysisController {
  constructor(private readonly sectionAnalysis: SectionAnalysisService) {}

  @Get("section-analysis")
  @ApiQuery({ name: "run_id", required: false, type: String, format: "uuid" })
  @ApiResponse({
    status: 200,
    description:
      "Техническое состояние выбранного секционного анализа и проверяемые факты; без вердиктов и решений инспектора",
  })
  status(
    @Req() request: AuthenticatedRequest,
    @Param("objectId", ParseUUIDPipe) objectId: string,
    @Res({ passthrough: true }) response: Response,
    @Query("run_id", new ParseUUIDPipe({ optional: true })) runId?: string,
  ) {
    response.setHeader("Cache-Control", "private, no-store");
    return this.sectionAnalysis.status(request.user.id, objectId, runId);
  }

  @Post("section-analysis")
  @HttpCode(202)
  @ApiBody({ schema: sectionAnalysisRequestSchema })
  @ApiResponse({
    status: 202,
    description:
      "Запрос принят идемпотентно: повтор с тем же request_id возвращает записанную задачу, новый запрос выбирает текущий базис анализа",
  })
  @ApiResponse({
    status: 400,
    schema: apiErrorSchema,
    description: "Неизвестный или повторный код параметра",
  })
  @ApiResponse({
    status: 404,
    schema: apiErrorSchema,
    description: "Запуск недоступен для объекта",
  })
  @ApiResponse({
    status: 409,
    schema: apiErrorSchema,
    description:
      "Режим отключён, запуск не текущий, источники не готовы либо процесс закрыт",
  })
  start(
    @Req() request: AuthenticatedRequest,
    @Param("objectId", ParseUUIDPipe) objectId: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "private, no-store");
    return this.sectionAnalysis.start(
      { userId: request.user.id, requestId: randomUUID(), ip: request.ip },
      objectId,
      body,
    );
  }
}
