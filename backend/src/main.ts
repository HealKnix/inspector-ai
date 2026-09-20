import "reflect-metadata";

import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import { json, type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";

import { AppModule } from "./app.module.js";
import {
  REFRESH_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_SECURITY_NAME,
} from "./common/const/auth.constants.js";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  const configService = app.get(ConfigService);
  const frontendUrl = configService.getOrThrow<string>("FRONTEND_URL");
  const trustProxyHops = configService.getOrThrow<number>("TRUST_PROXY_HOPS");

  app.setGlobalPrefix("api");
  if (trustProxyHops > 0) {
    app.set("trust proxy", trustProxyHops);
  }
  app.use(helmet());
  app.use(cookieParser());
  const parseJson = json({ limit: "100kb" });
  app.use((request: Request, response: Response, next: NextFunction) => {
    if (
      request.method === "POST" &&
      /^\/api\/v1\/documents\/upload\/?$/.test(request.path)
    )
      next();
    else parseJson(request, response, next);
  });
  app.enableCors({ credentials: true, origin: frontendUrl });
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Инспектор ИИ API")
    .setDescription(
      "Аутентификация, объекты строительства и безопасный приём документов",
    )
    .setVersion("0.1.0")
    .addBearerAuth(
      { bearerFormat: "JWT", scheme: "bearer", type: "http" },
      "access-token",
    )
    .addCookieAuth(
      REFRESH_TOKEN_COOKIE_NAME,
      { in: "cookie", name: REFRESH_TOKEN_COOKIE_NAME, type: "apiKey" },
      REFRESH_TOKEN_SECURITY_NAME,
    )
    .build();
  SwaggerModule.setup(
    "api/docs",
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

  await app.listen(configService.getOrThrow<number>("PORT"));
}

void bootstrap();
