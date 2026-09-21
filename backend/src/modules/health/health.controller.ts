import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";

import { Public } from "../../common/decorators/public.decorator.js";

@ApiTags("Состояние сервиса")
@Controller("health")
export class HealthController {
  @Public()
  @Get()
  @ApiOkResponse({ schema: { example: { ok: true } } })
  getHealth(): { ok: true } {
    return { ok: true };
  }
}
