import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiResponse, ApiTags } from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import { Roles } from "../../common/decorators/roles.decorator.js";
import { RolesGuard } from "../../common/guards/roles.guard.js";
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from "../auth/jwt-auth.guard.js";
import { apiErrorSchema } from "../documents/upload-contract.js";
import { MatrixAdminService } from "./matrix-admin.service.js";

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[0-9a-fA-F-]{36}$/.test(value))
    throw new BadRequestException(`${field}: требуется uuid`);
  return value;
}

@ApiTags("admin-matrix")
@ApiBearerAuth("access-token")
@ApiResponse({ status: 401, schema: apiErrorSchema })
@ApiResponse({ status: 403, schema: apiErrorSchema })
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMINISTRATOR")
@Controller("v1/admin/matrix")
export class MatrixAdminController {
  constructor(private readonly matrix: MatrixAdminService) {}

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
      properties: { plan: { type: "object" }, note: { type: "string" } },
    },
  })
  createDraft(
    @Req() request: AuthenticatedRequest,
    @Param("parameterCode") parameterCode: string,
    @Body() body: { plan?: unknown; note?: string },
  ) {
    if (body.plan === undefined)
      throw new BadRequestException("plan: объект плана обязателен");
    return this.matrix.createDraft(
      { userId: request.user.id, requestId: randomUUID(), ip: request.ip },
      parameterCode,
      { plan: body.plan, note: body.note },
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
