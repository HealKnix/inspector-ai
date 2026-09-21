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
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";
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

export type AdminDocumentStatsRange = "1d" | "3m" | "30d" | "7d";

export class AdminDocumentStatsQueryDto {
  @ApiPropertyOptional({
    enum: ["1d", "3m", "30d", "7d"],
    default: "3m",
    description:
      "Диапазон аналитики: сутки (почасово), 3 месяца, 30 или 7 дней",
  })
  @IsOptional()
  @IsIn(["1d", "3m", "30d", "7d"])
  range?: AdminDocumentStatsRange;
}

const STATS_RANGE_DAYS: Record<
  Exclude<AdminDocumentStatsRange, "1d">,
  number
> = {
  "3m": 90,
  "30d": 30,
  "7d": 7,
};

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const STATS_1D_HOURS = 24;

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

  @Get("stats")
  @ApiResponse({
    status: 200,
    description:
      "Сводная аналитика документов: итоги, дельта загрузок и дневная серия",
  })
  async stats(@Query() query: AdminDocumentStatsQueryDto) {
    const range = query.range ?? "3m";
    const to = new Date();
    const hourly = range === "1d";
    const from = hourly
      ? new Date(
          Math.floor(to.getTime() / HOUR_MS) * HOUR_MS -
            (STATS_1D_HOURS - 1) * HOUR_MS,
        )
      : new Date(
          Date.UTC(
            to.getUTCFullYear(),
            to.getUTCMonth(),
            to.getUTCDate() - (STATS_RANGE_DAYS[range] - 1),
          ),
        );
    const previousFrom = hourly
      ? new Date(from.getTime() - STATS_1D_HOURS * HOUR_MS)
      : new Date(from.getTime() - STATS_RANGE_DAYS[range] * DAY_MS);

    const [
      filesTotal,
      integrityErrors,
      uploadsCurrent,
      uploadsPrevious,
      stateRows,
      bucketRows,
    ] = await this.prisma.$transaction([
      this.prisma.file.count(),
      this.prisma.file.count({ where: { corruptedAt: { not: null } } }),
      this.prisma.file.count({ where: { createdAt: { gte: from } } }),
      this.prisma.file.count({
        where: { createdAt: { gte: previousFrom, lt: from } },
      }),
      this.prisma.$queryRaw<{ state: string; count: number }[]>`
        SELECT COALESCE(t.state, 'none') AS state, count(*)::int AS count
        FROM files f
        LEFT JOIN LATERAL (
          SELECT pt.state
          FROM parsing_tasks pt
          WHERE pt.file_id = f.id
          ORDER BY pt.cycle DESC
          LIMIT 1
        ) t ON TRUE
        GROUP BY 1
      `,
      hourly
        ? this.prisma.$queryRaw<{ bucket: string; uploads: number }[]>`
            SELECT to_char(date_trunc('hour', f.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24') AS bucket,
                   count(*)::int AS uploads
            FROM files f
            WHERE f.created_at >= ${from}
            GROUP BY 1
            ORDER BY 1
          `
        : this.prisma.$queryRaw<{ bucket: string; uploads: number }[]>`
            SELECT to_char(date_trunc('day', f.created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS bucket,
                   count(*)::int AS uploads
            FROM files f
            WHERE f.created_at >= ${from}
            GROUP BY 1
            ORDER BY 1
          `,
    ]);

    const stateCounts = new Map(stateRows.map((row) => [row.state, row.count]));
    const uploadsByBucket = new Map(
      bucketRows.map((row) => [row.bucket, row.uploads]),
    );
    const series: { date: string; uploads: number }[] = [];
    if (hourly) {
      for (let hour = 0; hour < STATS_1D_HOURS; hour += 1) {
        const slot = new Date(from.getTime() + hour * HOUR_MS);
        const key = slot.toISOString().slice(0, 13);
        series.push({
          date: slot.toISOString(),
          uploads: uploadsByBucket.get(key) ?? 0,
        });
      }
    } else {
      for (
        const day = new Date(from);
        day.getTime() <= to.getTime();
        day.setUTCDate(day.getUTCDate() + 1)
      ) {
        const date = day.toISOString().slice(0, 10);
        series.push({ date, uploads: uploadsByBucket.get(date) ?? 0 });
      }
    }

    return {
      range,
      totals: {
        files: filesTotal,
        succeeded: stateCounts.get("succeeded") ?? 0,
        in_progress:
          (stateCounts.get("queued") ?? 0) +
          (stateCounts.get("processing") ?? 0),
        failed: stateCounts.get("failed") ?? 0,
        integrity_errors: integrityErrors,
      },
      uploads: {
        current: uploadsCurrent,
        previous: uploadsPrevious,
        delta_percent:
          uploadsPrevious > 0
            ? Math.round(
                ((uploadsCurrent - uploadsPrevious) / uploadsPrevious) * 1000,
              ) / 10
            : null,
      },
      series,
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
