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
  REJECTION_REASON_CODES,
  type DecisionAction,
  type FindingStatusValue,
} from "./verification-contract.js";
import { VerificationService } from "./verification.service.js";

const FINDING_STATUSES: FindingStatusValue[] = [
  "CANDIDATE",
  "CONFIRMED_VIOLATION",
  "NEGATIVE_VERIFIED",
  "CLARIFICATION_REQUIRED",
  "MISSING_EVIDENCE",
  "NOT_COMPARABLE",
  "NOT_APPLICABLE",
];

class DecisionDto {
  @ApiProperty({
    format: "uuid",
    description: "Идемпотентный ключ решения; повтор возвращает записанное",
  })
  @IsUUID()
  request_id!: string;

  @ApiProperty({
    enum: ["confirm", "reject", "clarify", "reopen"],
    description:
      "confirm → CONFIRMED_VIOLATION; reject → NEGATIVE_VERIFIED " +
      "(reason_code + comment обязательны); clarify → CLARIFICATION_REQUIRED " +
      "(comment обязателен); reopen → возврат в CANDIDATE",
  })
  @IsIn(["confirm", "reject", "clarify", "reopen"])
  action!: DecisionAction;

  @ApiProperty({
    description: "Версия находки, которую видел инспектор (row_version)",
  })
  @IsInt()
  @Min(1)
  finding_version!: number;

  @ApiProperty({ required: false, enum: REJECTION_REASON_CODES })
  @IsOptional()
  @IsIn(REJECTION_REASON_CODES)
  reason_code?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  comment?: string;
}

class CancelFinalizationDto {
  @ApiProperty({ description: "Причина отмены финализации" })
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

class FindingQueryDto {
  @ApiProperty({ required: false, enum: FINDING_STATUSES })
  @IsOptional()
  @IsIn(FINDING_STATUSES)
  status?: FindingStatusValue;

  @ApiProperty({ required: false, description: "Фильтр по коду параметра" })
  @IsOptional()
  @IsString()
  q?: string;
}

@ApiTags("verification")
@ApiBearerAuth("access-token")
@ApiResponse({ status: 401, schema: apiErrorSchema })
@ApiResponse({ status: 403, schema: apiErrorSchema })
@ApiResponse({ status: 409, schema: apiErrorSchema })
@UseGuards(JwtAuthGuard)
@Controller("v1/objects/:objectId")
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Post("protocol/generate")
  @ApiResponse({
    status: 201,
    description:
      "Новая версия протокола из снимка evidence_groups; 409 — обработка " +
      "не завершена или процесс в PARSING/FINALIZED; повтор без изменений " +
      "возвращает активную версию",
  })
  generate(
    @Req() request: AuthenticatedRequest,
    @Param("objectId", ParseUUIDPipe) objectId: string,
  ) {
    return this.verification.generate(
      { userId: request.user.id, requestId: randomUUID(), ip: request.ip },
      objectId,
    );
  }

  @Get("protocol")
  @ApiResponse({
    status: 200,
    description:
      "Активная версия протокола со счётчиками и история версий процесса",
  })
  getProtocol(
    @Req() request: AuthenticatedRequest,
    @Param("objectId", ParseUUIDPipe) objectId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "private, no-store");
    return this.verification.getProtocol(request.user.id, objectId);
  }

  @Get("findings")
  @ApiResponse({
    status: 200,
    description: "Находки активной версии протокола с фильтром по статусу",
  })
  listFindings(
    @Req() request: AuthenticatedRequest,
    @Param("objectId", ParseUUIDPipe) objectId: string,
    @Query() query: FindingQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "private, no-store");
    return this.verification.listFindings(request.user.id, objectId, {
      status: query.status,
      q: query.q,
    });
  }

  @Get("findings/:findingId")
  @ApiResponse({
    status: 200,
    description:
      "Карточка находки: снимок вердикта, члены группы с локаторами " +
      "доказательств, история решений",
  })
  getFinding(
    @Req() request: AuthenticatedRequest,
    @Param("objectId", ParseUUIDPipe) objectId: string,
    @Param("findingId", ParseUUIDPipe) findingId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "private, no-store");
    return this.verification.getFinding(request.user.id, objectId, findingId);
  }

  @Post("findings/:findingId/decision")
  @ApiResponse({
    status: 201,
    description:
      "Решение инспектора; 409 — статус процесса не READY/VERIFYING, " +
      "устаревшая finding_version или недопустимый переход; 400 — отклонение " +
      "без reason_code/комментария",
  })
  decide(
    @Req() request: AuthenticatedRequest,
    @Param("objectId", ParseUUIDPipe) objectId: string,
    @Param("findingId", ParseUUIDPipe) findingId: string,
    @Body() body: DecisionDto,
  ) {
    return this.verification.decide(
      { userId: request.user.id, requestId: randomUUID(), ip: request.ip },
      objectId,
      findingId,
      body,
    );
  }

  @Post("protocol/finalize")
  @ApiResponse({
    status: 201,
    description:
      "Финализация протокола; 409 — есть неразрешённые CANDIDATE или " +
      "статус процесса не READY/VERIFYING/COMPLETED",
  })
  finalize(
    @Req() request: AuthenticatedRequest,
    @Param("objectId", ParseUUIDPipe) objectId: string,
  ) {
    return this.verification.finalize(
      { userId: request.user.id, requestId: randomUUID(), ip: request.ip },
      objectId,
    );
  }

  @Post("protocol/finalize/cancel")
  @ApiResponse({
    status: 201,
    description:
      "Отмена финализации (только администратор, причина обязательна); " +
      "процесс возвращается в COMPLETED",
  })
  cancelFinalization(
    @Req() request: AuthenticatedRequest,
    @Param("objectId", ParseUUIDPipe) objectId: string,
    @Body() body: CancelFinalizationDto,
  ) {
    return this.verification.cancelFinalization(
      { userId: request.user.id, requestId: randomUUID(), ip: request.ip },
      objectId,
      body,
    );
  }
}
