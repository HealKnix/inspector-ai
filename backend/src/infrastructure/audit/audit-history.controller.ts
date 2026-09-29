import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import type { AuthenticatedRequest } from "../../modules/auth/jwt-auth.guard.js";
import { AuditHistoryService } from "./audit-history.service.js";

class AuditHistoryQuery {
  @ApiProperty({ required: false, minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  cursor?: string;
  @ApiProperty({ required: false, format: "uuid" })
  @IsOptional()
  @IsUUID()
  protocol_id?: string;
}

@Controller("v1/objects/:objectId/audit-events")
@ApiTags("audit")
@ApiBearerAuth("access-token")
export class AuditHistoryController {
  constructor(private readonly history: AuditHistoryService) {}
  @Get()
  @ApiOperation({
    summary: "Сохранённая история доступного объекта/версии",
    description:
      "Только назначенный инспектор. Убывающий курсор created_at + event_id; новые записи доступны после обновления первой страницы. Отсутствующие старые metadata и decision обозначены null, details ограничены безопасным перечнем полей.",
  })
  @ApiResponse({
    status: 200,
    description:
      "schema_version, object_id, protocol_id, items (event_id/action/occurred_at/request_id/correlation_id/actor/ip_address/user_agent/details/decision), next_cursor",
  })
  @ApiResponse({
    status: 403,
    description: "Нет назначения или роли инспектора",
  })
  @ApiResponse({ status: 400, description: "Некорректные фильтры/курсор" })
  get(
    @Req() request: AuthenticatedRequest,
    @Param("objectId", ParseUUIDPipe) objectId: string,
    @Query() query: AuditHistoryQuery,
  ) {
    return this.history.list(request.user.id, objectId, query);
  }
}
