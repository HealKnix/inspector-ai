import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from "class-validator";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import {
  JwtAuthGuard,
  type AuthenticatedRequest,
} from "../auth/jwt-auth.guard.js";
import { apiErrorSchema } from "../documents/upload-contract.js";
import {
  completenessResultSchema,
  expectedPackageSchema,
} from "./completeness-openapi.js";
import { CompletenessService } from "./completeness.service.js";

class GeneratePackageDto {
  @ApiProperty({
    type: "object",
    additionalProperties: true,
    description:
      "Атрибуты объекта, влияющие на применимость требований каркаса",
  })
  @IsObject()
  attributes!: Record<string, unknown>;

  @ApiProperty({
    type: "array",
    required: false,
    description: "Ручные элементы объектных перечней (дополняют извлечённые)",
  })
  @IsOptional()
  lists?: { list_kind: string; item_key: string; title: string }[];
}

class ConfirmPackageDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  request_id!: string;

  @ApiProperty({ description: "Версия перечня, которую видел инспектор" })
  @IsInt()
  @Min(1)
  expected_version!: number;

  @ApiProperty({ description: "Основание подтверждения состава" })
  @IsString()
  @IsNotEmpty()
  basis!: string;

  @ApiProperty({ type: "object", additionalProperties: true })
  @IsObject()
  attributes!: Record<string, unknown>;

  @ApiProperty({ type: "array", required: false })
  @IsOptional()
  exclude?: { requirement_id: string; reason: string }[];

  @ApiProperty({ type: "array", required: false })
  @IsOptional()
  include?: {
    stage: "PD" | "RD" | "ID";
    kind_code: string;
    title: string;
    scope?: unknown;
    quantity?: { min: number; per?: string };
    alternatives?: unknown;
    source?: unknown;
  }[];
}

class EvaluateDto {
  @ApiProperty({ format: "uuid", required: false })
  @IsOptional()
  @IsUUID()
  run_id?: string;
}

class RunQueryDto {
  @ApiProperty({ format: "uuid", required: false })
  @IsOptional()
  @IsUUID()
  run_id?: string;

  @IsOptional()
  @IsIn(["v1"])
  format?: string;
}

@ApiTags("completeness")
@ApiBearerAuth("access-token")
@ApiResponse({ status: 401, schema: apiErrorSchema })
@ApiResponse({ status: 403, schema: apiErrorSchema })
@ApiResponse({ status: 409, schema: apiErrorSchema })
@UseGuards(JwtAuthGuard)
@Controller("v1/objects/:objectId")
export class CompletenessController {
  constructor(private readonly completeness: CompletenessService) {}

  @Get("completeness/package")
  @ApiResponse({
    status: 200,
    schema: expectedPackageSchema,
    description:
      "Актуальная версия ожидаемого состава с источниками требований",
  })
  getPackage(
    @Req() request: AuthenticatedRequest,
    @Param("objectId", ParseUUIDPipe) objectId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "private, no-store");
    return this.completeness.getPackage(request.user.id, objectId);
  }

  @Post("completeness/package/generate")
  @ApiResponse({
    status: 201,
    description:
      "Новая proposed-версия перечня из утверждённого каркаса и извлечённых перечней",
  })
  generate(
    @Req() request: AuthenticatedRequest,
    @Param("objectId", ParseUUIDPipe) objectId: string,
    @Body() body: GeneratePackageDto,
  ) {
    return this.completeness.generate(
      { userId: request.user.id, requestId: randomUUID(), ip: request.ip },
      objectId,
      body,
    );
  }

  @Post("completeness/package/confirm")
  @ApiResponse({
    status: 201,
    description:
      "Подтверждённая версия перечня; повтор request_id возвращает ту же версию",
  })
  confirm(
    @Req() request: AuthenticatedRequest,
    @Param("objectId", ParseUUIDPipe) objectId: string,
    @Body() body: ConfirmPackageDto,
  ) {
    return this.completeness.confirm(
      { userId: request.user.id, requestId: randomUUID(), ip: request.ip },
      objectId,
      body,
    );
  }

  @Post("completeness/evaluate")
  @ApiResponse({
    status: 201,
    schema: completenessResultSchema,
    description:
      "Детерминированная оценка по подтверждённому перечню и снапшоту запуска",
  })
  evaluate(
    @Req() request: AuthenticatedRequest,
    @Param("objectId", ParseUUIDPipe) objectId: string,
    @Body() body: EvaluateDto,
  ) {
    return this.completeness.evaluate(
      { userId: request.user.id, requestId: randomUUID(), ip: request.ip },
      objectId,
      body,
    );
  }

  @Get("completeness/result")
  @ApiResponse({
    status: 200,
    schema: completenessResultSchema,
    description: "Последний результат оценки либо явная причина его отсутствия",
  })
  getResult(
    @Req() request: AuthenticatedRequest,
    @Param("objectId", ParseUUIDPipe) objectId: string,
    @Query() query: RunQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "private, no-store");
    return this.completeness.getResult(request.user.id, objectId, query.run_id);
  }
}
