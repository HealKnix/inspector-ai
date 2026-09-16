import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";

@ApiTags("Состояние сервиса")
@Controller("health")
export class HealthController {
  @Get()
  @ApiOkResponse({ schema: { example: { ok: true } } })
  getHealth(): { ok: true } {
    return { ok: true };
  }
}
