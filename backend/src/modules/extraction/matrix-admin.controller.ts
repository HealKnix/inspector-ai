import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiResponse, ApiTags } from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { type AuthenticatedRequest } from "../auth/jwt-auth.guard.js";
import { apiErrorSchema } from "../documents/upload-contract.js";
import { MatrixAdminService } from "./matrix-admin.service.js";
import {
  passportInputSchema,
  regressionEngines,
  regressionInputSchema,
} from "./matrix-review-contract.js";
import { MatrixReviewService } from "./matrix-review.service.js";

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[0-9a-fA-F-]{36}$/.test(value))
    throw new BadRequestException(`${field}: требуется uuid`);
  return value;
}

@ApiTags("admin-matrix")
@ApiBearerAuth("access-token")
@ApiResponse({ status: 401, schema: apiErrorSchema })
@ApiResponse({ status: 403, schema: apiErrorSchema })
@Roles("ADMINISTRATOR")
@Controller("v1/admin/matrix")
export class MatrixAdminController {
  constructor(
    private readonly matrix: MatrixAdminService,
    private readonly review: MatrixReviewService,
  ) {}

  @Get("review-contract")
  reviewContract() {
    return {
      schema_version: 1,
      passport: passportInputSchema,
      regression: regressionInputSchema,
      engines: regressionEngines,
    };
  }

  @Get("rules/:ruleId/review")
  reviewHistory(@Param("ruleId") ruleId: string) {
    return this.review.history(uuid(ruleId, "ruleId"));
  }

  @Post("rules/:ruleId/passport")
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: "object",
      required: passportInputSchema.required,
      description:
        "matrix-review-v1. Полная исполняемая JSON Schema: GET /api/v1/admin/matrix/review-contract, поле passport.",
      properties: {
        schema_version: { type: "integer", enum: [1] },
        matrix_row_id: { type: "string", format: "uuid" },
        quantity: { type: "string", nullable: true },
        applicability: { type: "string", nullable: true },
        scope: { type: "string", nullable: true },
        sources: {
          type: "array",
          items: { type: "string", enum: ["PD", "RD", "ID"] },
        },
        unit: { type: "string", nullable: true },
        rounding: { type: "string", nullable: true },
        branches: { type: "array", items: { type: "object" } },
      },
      additionalProperties: false,
    },
  })
  passport(
    @Req() request: AuthenticatedRequest,
    @Param("ruleId") ruleId: string,
    @Body() body: unknown,
  ) {
    return this.review.savePassport(
      { userId: request.user.id, requestId: randomUUID(), ip: request.ip },
      uuid(ruleId, "ruleId"),
      body,
    );
  }

  @Post("rules/:ruleId/regression")
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: "object",
      required: ["schema_version", "fixtures"],
      additionalProperties: false,
      description:
        "matrix-review-v1. Сервер исполняет fixtures; клиентский report не принимается. Полная JSON Schema: GET /api/v1/admin/matrix/review-contract, поле regression.",
      properties: {
        schema_version: { type: "integer", enum: [1] },
        fixtures: {
          type: "array",
          minItems: 1,
          maxItems: 260,
          items: { type: "object" },
        },
      },
    },
  })
  regression(
    @Req() request: AuthenticatedRequest,
    @Param("ruleId") ruleId: string,
    @Body() body: unknown,
  ) {
    return this.review.runRegression(
      { userId: request.user.id, requestId: randomUUID(), ip: request.ip },
      uuid(ruleId, "ruleId"),
      body,
    );
  }

  @Get("rows")
  @ApiResponse({
    status: 200,
    description: "Все строки контрольной матрицы с сырыми полями импорта",
  })
  rows() {
    return this.matrix.listRows();
  }

  @Get("rows/:parameterCode/rules")
  rules(@Param("parameterCode") parameterCode: string) {
    return this.matrix.getRow(parameterCode);
  }

  @Post("rows/:parameterCode/rules")
  @ApiBody({
    schema: {
      type: "object",
      required: ["plan"],
      properties: {
        plan: { type: "object" },
        comparison: { type: "object" },
        note: { type: "string" },
      },
    },
  })
  createDraft(
    @Req() request: AuthenticatedRequest,
    @Param("parameterCode") parameterCode: string,
    @Body() body: { plan?: unknown; comparison?: unknown; note?: string },
  ) {
    if (body.plan === undefined)
      throw new BadRequestException("plan: объект плана обязателен");
    return this.matrix.createDraft(
      { userId: request.user.id, requestId: randomUUID(), ip: request.ip },
      parameterCode,
      { plan: body.plan, comparison: body.comparison, note: body.note },
    );
  }

  @Post("rows/:parameterCode/draft-llm")
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: "object",
      required: ["object_id"],
      properties: {
        object_id: { type: "string", format: "uuid" },
        file_id: { type: "string", format: "uuid" },
        terms: { type: "array", items: { type: "string" } },
      },
    },
  })
  draftLlm(
    @Req() request: AuthenticatedRequest,
    @Param("parameterCode") parameterCode: string,
    @Body()
    body: { object_id?: string; file_id?: string; terms?: string[] },
  ) {
    return this.matrix.draftWithLlm(
      { userId: request.user.id, requestId: randomUUID(), ip: request.ip },
      parameterCode,
      {
        object_id: uuid(body.object_id, "object_id"),
        file_id: body.file_id ? uuid(body.file_id, "file_id") : undefined,
        terms: body.terms,
      },
    );
  }

  @Post("rules/:ruleId/dry-run")
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: "object",
      required: ["object_id"],
      properties: {
        object_id: { type: "string", format: "uuid" },
        file_id: { type: "string", format: "uuid" },
      },
    },
  })
  dryRun(
    @Param("ruleId") ruleId: string,
    @Body() body: { object_id?: string; file_id?: string },
  ) {
    return this.matrix.dryRun(uuid(ruleId, "ruleId"), {
      object_id: uuid(body.object_id, "object_id"),
      file_id: body.file_id ? uuid(body.file_id, "file_id") : undefined,
    });
  }

  @Post("rules/:ruleId/approve")
  @HttpCode(200)
  approve(
    @Req() request: AuthenticatedRequest,
    @Param("ruleId") ruleId: string,
  ) {
    return this.matrix.approve(
      { userId: request.user.id, requestId: randomUUID(), ip: request.ip },
      uuid(ruleId, "ruleId"),
    );
  }

  @Post("rules/:ruleId/reject")
  @HttpCode(200)
  reject(
    @Req() request: AuthenticatedRequest,
    @Param("ruleId") ruleId: string,
  ) {
    return this.matrix.reject(
      { userId: request.user.id, requestId: randomUUID(), ip: request.ip },
      uuid(ruleId, "ruleId"),
    );
  }

  @Post("search")
  @HttpCode(200)
  @ApiBody({
    schema: {
      type: "object",
      required: ["object_id", "terms"],
      properties: {
        object_id: { type: "string", format: "uuid" },
        file_id: { type: "string", format: "uuid" },
        terms: { type: "array", items: { type: "string" } },
      },
    },
  })
  search(
    @Body()
    body: {
      object_id?: string;
      file_id?: string;
      terms?: string[];
    },
  ) {
    return this.matrix.search({
      object_id: uuid(body.object_id, "object_id"),
      file_id: body.file_id ? uuid(body.file_id, "file_id") : undefined,
      terms: body.terms ?? [],
    });
  }
}
