import {
  Controller,
  Get,
  Logger,
  MiddlewareConsumer,
  Module,
  NotFoundException,
  Req,
  Res,
  UnauthorizedException,
  type NestModule,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiExcludeController } from "@nestjs/swagger";
import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { Public } from "../../common/decorators/public.decorator.js";
import { PrismaService } from "../prisma/prisma.service.js";
import {
  metricsAuthorized,
  renderMetrics,
  technicalMetrics,
} from "./metrics.js";
import { traceContext } from "./trace-context.js";

export function observationMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  // A supplied HTTP header cannot forge server request identity or authorization.
  const requestId = randomUUID();
  const started = performance.now();
  const context = {
    request_id: requestId,
    correlation_id: requestId,
    user_id: null,
    actor_kind: "user" as const,
    user_agent: request.headers["user-agent"] ?? null,
  };
  response.setHeader("X-Request-Id", requestId);
  traceContext.run(context, () => {
    response.once("finish", () => {
      technicalMetrics.observeHttp(
        request.method,
        response.statusCode,
        (performance.now() - started) / 1000,
      );
      new Logger("HttpObservability").log({
        event: "http.request.finished",
        http_status: response.statusCode,
        duration_ms: performance.now() - started,
      });
    });
    next();
  });
}

@Controller("internal/metrics")
@ApiExcludeController()
class MetricsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}
  // JWT bypass is only for the separate technical credential, checked below.
  @Public()
  @Get()
  async get(@Req() request: Request, @Res() response: Response) {
    const token = this.config.get<string>("METRICS_TOKEN");
    if (!token) throw new NotFoundException();
    if (!metricsAuthorized(token, request.headers.authorization))
      throw new UnauthorizedException();
    response.setHeader("Content-Type", "text/plain; version=0.0.4");
    response.setHeader("Cache-Control", "no-store");
    response.send(
      await renderMetrics(
        this.prisma,
        this.config.getOrThrow<string>("STORAGE_ROOT"),
        this.config.get<string>("RABBITMQ_URL"),
      ),
    );
  }
}

@Module({ controllers: [MetricsController] })
export class ObservabilityModule implements NestModule {
  constructor(config: ConfigService) {
    const token = config.get<string>("METRICS_TOKEN");
    if (token && (token.length < 32 || token.length > 256))
      throw new Error("METRICS_TOKEN must contain 32–256 characters");
  }
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(observationMiddleware).forRoutes("{*path}");
  }
}
