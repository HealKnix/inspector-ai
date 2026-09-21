import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Req,
  Res,
} from "@nestjs/common";
import { ApiBearerAuth, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { type AuthenticatedRequest } from "../auth/jwt-auth.guard.js";
import { apiErrorSchema } from "../documents/upload-contract.js";
import { ExtractionService } from "./extraction.service.js";

@ApiTags("extraction")
@ApiBearerAuth("access-token")
@ApiResponse({ status: 401, schema: apiErrorSchema })
@ApiResponse({ status: 403, schema: apiErrorSchema })
@Controller("v1/objects/:objectId")
export class ExtractionController {
  constructor(private readonly extraction: ExtractionService) {}

  @Get("extractions")
  @ApiResponse({
    status: 200,
    description:
      "Извлечённые значения параметров по утверждённым правилам; статусы ambiguous/no_evidence/unsupported — явные, без вердикта о нарушении",
  })
  list(
    @Req() request: AuthenticatedRequest,
    @Param("objectId", ParseUUIDPipe) objectId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "private, no-store");
    return this.extraction.list(request.user.id, objectId);
  }

  @Get("evidence-groups")
  @ApiResponse({
    status: 200,
    description:
      "Группы доказательств по параметрам: expected — из ПД, actual — из РД/ИД; без сравнения значений",
  })
  groups(
    @Req() request: AuthenticatedRequest,
    @Param("objectId", ParseUUIDPipe) objectId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "private, no-store");
    return this.extraction.groups(request.user.id, objectId);
  }
}
