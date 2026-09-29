import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import { Roles } from "../../common/decorators/roles.decorator.js";
import type { AuthenticatedRequest } from "../auth/jwt-auth.guard.js";
import { RuleSetReleaseService } from "./rule-set-release.service.js";
@ApiTags("admin-matrix")
@ApiBearerAuth("access-token")
@Roles("ADMINISTRATOR")
@Controller("v1/admin/matrix/releases")
export class RuleSetReleaseController {
  constructor(private readonly releases: RuleSetReleaseService) {}
  @Get() list() {
    return this.releases.list();
  }
  @Get(":id") get(@Param("id") id: string) {
    return this.releases.get(id);
  }
  @Post()
  @HttpCode(200)
  build(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.releases.build(
      { userId: request.user.id, requestId: randomUUID(), ip: request.ip },
      body,
    );
  }
  @Post(":id/publish")
  @HttpCode(200)
  publish(
    @Req() request: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.releases.publish(
      { userId: request.user.id, requestId: randomUUID(), ip: request.ip },
      id,
      body,
    );
  }
}
