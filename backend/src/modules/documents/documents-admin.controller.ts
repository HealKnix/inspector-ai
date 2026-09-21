import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  Res,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiPropertyOptional,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsOptional, IsString, IsUUID, MaxLength } from "class-validator";
import type { Response } from "express";

import { Roles } from "../../common/decorators/roles.decorator.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { PageQueryDto } from "../objects/objects.dto.js";
import { ParsingPageQueryDto } from "../parsing/parsing.controller.js";
import { ParsingService } from "../parsing/parsing.service.js";
import { apiErrorSchema } from "./upload-contract.js";

export class AdminDocumentsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    format: "uuid",
    description: "Оставить только файлы, загруженные пользователем",
  })
  @IsOptional()
  @IsUUID()
  user_id?: string;

  @ApiPropertyOptional({
    format: "uuid",
    description: "Оставить только файлы выбранного объекта",
  })
  @IsOptional()
  @IsUUID()
  object_id?: string;

  @ApiPropertyOptional({
    description:
      "Поиск по имени файла, названию объекта и пользователю (регистронезависимый)",
    maxLength: 200,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === "string" ? value.trim() : value,
  )
  @IsString()
  @MaxLength(200)
  q?: string;
}

@ApiTags("admin-documents")
@ApiBearerAuth("access-token")
@ApiResponse({ status: 401, schema: apiErrorSchema })
@ApiResponse({ status: 403, schema: apiErrorSchema })
@ApiResponse({
  status: 404,
  schema: apiErrorSchema,
  description: "Файл не найден",
})
@ApiResponse({
  status: 409,
  schema: apiErrorSchema,
  description: "Результат текущего запуска ещё недоступен или изменился",
})
@ApiResponse({
  status: 503,
  schema: apiErrorSchema,
  description: "Сохранённый результат недоступен или повреждён",
})
@Roles("ADMINISTRATOR")
@Controller("v1/admin/documents")
export class DocumentsAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly parsing: ParsingService,
  ) {}

  @Get()
  async list(@Query() query: AdminDocumentsQueryDto) {
    const search = query.q || undefined;
    const where: Prisma.FileWhereInput = {
      ...(query.user_id ? { uploadedBy: query.user_id } : {}),
      ...(query.object_id ? { objectId: query.object_id } : {}),
      ...(search
        ? {
            OR: [
              { originalName: { contains: search, mode: "insensitive" } },
              {
                object: { name: { contains: search, mode: "insensitive" } },
              },
              {
                uploader: {
                  OR: [
                    { login: { contains: search, mode: "insensitive" } },
                    { lastName: { contains: search, mode: "insensitive" } },
                    { firstName: { contains: search, mode: "insensitive" } },
                  ],
                },
              },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.file.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: {
          id: true,
          objectId: true,
          processId: true,
          runId: true,
          originalName: true,
          format: true,
          size: true,
          sha256: true,
          createdAt: true,
          corruptedAt: true,
          object: { select: { name: true } },
          uploader: {
            select: {
              id: true,
              login: true,
              lastName: true,
              firstName: true,
              patronymic: true,
            },
          },
          parsingTasks: {
            orderBy: { cycle: "desc" },
            take: 1,
            select: {
              state: true,
              pagesTotal: true,
              errorCode: true,
              artifact: { select: { id: true } },
            },
          },
        },
      }),
      this.prisma.file.count({ where }),
    ]);

    return {
      items: items.map((file) => {
        const task = file.parsingTasks[0];

        return {
          id: file.id,
          object_id: file.objectId,
          object_name: file.object.name,
          process_id: file.processId,
          run_id: file.runId,
          original_name: file.originalName,
          size: file.size,
          format: file.format,
          sha256: file.sha256,
          created_at: file.createdAt.toISOString(),
          integrity_error: file.corruptedAt !== null,
          uploaded_by: {
            id: file.uploader.id,
            login: file.uploader.login,
            last_name: file.uploader.lastName,
            first_name: file.uploader.firstName,
            patronymic: file.uploader.patronymic,
          },
          parsing: task
            ? {
                state: task.state,
                pages_total: task.pagesTotal,
                error_code: task.errorCode,
                artifact_id:
                  task.state === "succeeded"
                    ? (task.artifact?.id ?? null)
                    : null,
              }
            : null,
        };
      }),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  @Get(":fileId/parse")
  @ApiResponse({
    status: 200,
    description:
      "Проверенный ParseArtifact v1 текущего Run; доступ не зависит от назначения на объект",
  })
  async artifact(
    @Param("fileId", ParseUUIDPipe) fileId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Cache-Control", "private, no-store");
    return this.parsing.adminArtifact(fileId);
  }

  @Get(":fileId/parse/pages/:pageNumber")
  @ApiResponse({
    status: 200,
    description:
      "PNG опубликованного артефакта для административного просмотра",
    content: { "image/png": { schema: { type: "string", format: "binary" } } },
  })
  async page(
    @Param("fileId", ParseUUIDPipe) fileId: string,
    @Param("pageNumber", ParseIntPipe) pageNumber: number,
    @Query() query: ParsingPageQueryDto,
    @Res() response: Response,
  ) {
    const page = await this.parsing.adminPage(
      fileId,
      pageNumber,
      query.artifact_id,
    );
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Type", "image/png");
    response.setHeader("X-Artifact-Id", page.artifactId);
    response.send(page.bytes);
  }
}
