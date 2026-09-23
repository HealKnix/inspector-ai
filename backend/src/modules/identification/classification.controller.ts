import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from "class-validator";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import { type AuthenticatedRequest } from "../auth/jwt-auth.guard.js";
import { apiErrorSchema } from "../documents/upload-contract.js";
import type { ClassificationStage } from "./classification-contract.js";
import { classificationListSchema } from "./classification-openapi.js";
import { ClassificationService } from "./classification.service.js";

export class ClassificationRetryDto {
  @ApiProperty({
    format: "uuid",
    description: "Идемпотентный идентификатор повтора классификации",
  })
  @IsUUID()
  request_id!: string;
}

export class ClassificationResolveDto {
  @ApiProperty({
    description: "Код вида документа из словаря утверждённого каркаса",
    example: "AOSR",
  })
  @IsString()
  @IsNotEmpty()
  kind_code!: string;

  @ApiProperty({
    enum: ["PD", "RD", "ID"],
    required: false,
    description:
      "Стадия; обязательна, когда код встречается в словарях нескольких стадий",
  })
  @IsOptional()
  @IsIn(["PD", "RD", "ID"])
  stage?: ClassificationStage;
}

@ApiTags("classification")
@ApiBearerAuth("access-token")
@ApiResponse({ status: 401, schema: apiErrorSchema })
@ApiResponse({ status: 403, schema: apiErrorSchema })
@ApiResponse({ status: 409, schema: apiErrorSchema })
@Controller("v1/objects/:objectId")
export class ClassificationController {
  constructor(private readonly classification: ClassificationService) {}

  @Get("classification")
  @ApiResponse({
    status: 200,
    schema: classificationListSchema,
    description:
      "Классификация ПД/РД/ИД текущих опубликованных артефактов; LLM-предложения требуют уточнения",
  })
  list(
    @Req() request: AuthenticatedRequest,
    @Param("objectId", ParseUUIDPipe) objectId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "private, no-store");
    return this.classification.list(request.user.id, objectId);
  }

  @Get("classification/kind-options")
  @ApiResponse({
    status: 200,
    description:
      "Виды документов утверждённого каркаса для ручного разрешения, по стадиям",
    schema: {
      type: "object",
      required: ["schema_version", "options"],
      properties: {
        schema_version: { type: "integer", enum: [1] },
        options: {
          type: "object",
          required: ["PD", "RD", "ID"],
          additionalProperties: {
            type: "array",
            items: {
              type: "object",
              required: ["code", "title"],
              properties: {
                code: { type: "string" },
                title: { type: "string" },
              },
            },
          },
        },
      },
    },
  })
  kindOptions(
    @Req() request: AuthenticatedRequest,
    @Param("objectId", ParseUUIDPipe) objectId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "private, no-store");
    return this.classification.kindOptions(request.user.id, objectId);
  }

  @Post("files/:fileId/classification/resolve")
  @HttpCode(200)
  @ApiResponse({
    status: 200,
    description:
      "Ручное разрешение вида документа новым циклом классификации; повтор с тем же видом не создаёт цикл",
    schema: {
      type: "object",
      required: ["task_id", "unchanged"],
      properties: {
        task_id: { type: "string", format: "uuid" },
        unchanged: { type: "boolean" },
      },
    },
  })
  resolve(
    @Req() request: AuthenticatedRequest,
    @Param("objectId", ParseUUIDPipe) objectId: string,
    @Param("fileId", ParseUUIDPipe) fileId: string,
    @Body() body: ClassificationResolveDto,
  ) {
    return this.classification.resolve(
      { userId: request.user.id, requestId: randomUUID(), ip: request.ip },
      objectId,
      fileId,
      body,
    );
  }

  @Post("files/:fileId/classification/retry")
  @HttpCode(202)
  @ApiResponse({
    status: 202,
    description: "Новая попытка классификации без повторного OCR",
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
    @Body() body: ClassificationRetryDto,
  ) {
    return this.classification.retry(
      { userId: request.user.id, requestId: randomUUID(), ip: request.ip },
      objectId,
      fileId,
      body.request_id,
    );
  }
}
