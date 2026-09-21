import { Controller, Get } from "@nestjs/common";
import { ApiBearerAuth, ApiResponse, ApiTags } from "@nestjs/swagger";

import { Roles } from "../../common/decorators/roles.decorator.js";
import { apiErrorSchema } from "../documents/upload-contract.js";
import { ObjectsService } from "./objects.service.js";

@ApiTags("admin-objects")
@ApiBearerAuth("access-token")
@ApiResponse({ status: 401, schema: apiErrorSchema })
@ApiResponse({ status: 403, schema: apiErrorSchema })
@Roles("ADMINISTRATOR")
@Controller("v1/admin/objects")
export class ObjectsAdminController {
  constructor(private readonly objects: ObjectsService) {}

  @Get()
  @ApiResponse({
    status: 200,
    description:
      "Все объекты без проверки назначения; для фильтров администратора",
  })
  list() {
    return this.objects.listAll();
  }
}
