import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiTags,
} from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import { type AuthenticatedRequest } from "../auth/jwt-auth.guard.js";
import {
  CreateObjectDto,
  ObjectDto,
  ObjectListDto,
  PageQueryDto,
} from "./objects.dto.js";
import { ObjectsService } from "./objects.service.js";

@ApiTags("objects")
@ApiBearerAuth("access-token")
@ApiForbiddenResponse({
  description: "Нет права действия или назначения на объект",
  schema: {
    type: "object",
    required: ["statusCode", "message", "error"],
    properties: {
      statusCode: { type: "integer" },
      message: { type: "string" },
      error: { type: "string" },
    },
    example: {
      statusCode: 403,
      message: "Объект недоступен",
      error: "Forbidden",
    },
  },
})
@Controller("v1/objects")
export class ObjectsController {
  constructor(private readonly objects: ObjectsService) {}

  @Post()
  @ApiCreatedResponse({ type: ObjectDto })
  create(@Req() request: AuthenticatedRequest, @Body() dto: CreateObjectDto) {
    return this.objects.create(
      { userId: request.user.id, ip: request.ip, requestId: randomUUID() },
      dto.name,
    );
  }

  @Get()
  @ApiOkResponse({
    type: ObjectListDto,
    example: {
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      allowed_actions: ["create"],
    },
  })
  list(@Req() request: AuthenticatedRequest, @Query() query: PageQueryDto) {
    return this.objects.list(request.user.id, query);
  }

  @Get(":objectId")
  @ApiOkResponse({ type: ObjectDto })
  get(
    @Req() request: AuthenticatedRequest,
    @Param("objectId", ParseUUIDPipe) objectId: string,
  ) {
    return this.objects.get(request.user.id, objectId);
  }
}
