import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";

import {
  AUTH_REQUEST_HEADER,
  AUTH_REQUEST_HEADER_VALUE,
  getRefreshTokenCookieClearOptions,
  getRefreshTokenCookieOptions,
  REFRESH_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_SECURITY_NAME,
} from "../../common/const/auth.constants.js";
import { AuthRequestGuard } from "./auth-request.guard.js";
import { AuthService, type SessionResult } from "./auth.service.js";
import { AuthResponseDto, UserResponseDto } from "./dto/auth-response.dto.js";
import { LoginDto } from "./dto/login.dto.js";
import { RegisterDto } from "./dto/register.dto.js";
import { type AuthenticatedRequest, JwtAuthGuard } from "./jwt-auth.guard.js";

function getRefreshToken(request: Request): string | undefined {
  const cookies: unknown = request.cookies;

  if (
    typeof cookies !== "object" ||
    cookies === null ||
    !(REFRESH_TOKEN_COOKIE_NAME in cookies)
  ) {
    return undefined;
  }

  const token = Reflect.get(cookies, REFRESH_TOKEN_COOKIE_NAME);
  return typeof token === "string" ? token : undefined;
}

@ApiTags("Аутентификация")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post("register")
  @UseGuards(AuthRequestGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiHeader({
    name: AUTH_REQUEST_HEADER,
    required: true,
    example: AUTH_REQUEST_HEADER_VALUE,
  })
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiConflictResponse({ description: "Логин уже занят" })
  @ApiForbiddenResponse({
    description: "Не пройдена проверка источника запроса",
  })
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    const session = await this.authService.register(dto);
    return this.completeAuthentication(response, session);
  }

  @Post("login")
  @UseGuards(AuthRequestGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiHeader({
    name: AUTH_REQUEST_HEADER,
    required: true,
    example: AUTH_REQUEST_HEADER_VALUE,
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiForbiddenResponse({
    description: "Не пройдена проверка источника запроса",
  })
  @ApiUnauthorizedResponse({ description: "Неверные учётные данные" })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    const session = await this.authService.login(dto.login, dto.password);
    return this.completeAuthentication(response, session);
  }

  @Post("refresh")
  @UseGuards(AuthRequestGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiHeader({
    name: AUTH_REQUEST_HEADER,
    required: true,
    example: AUTH_REQUEST_HEADER_VALUE,
  })
  @ApiCookieAuth(REFRESH_TOKEN_SECURITY_NAME)
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiForbiddenResponse({
    description: "Не пройдена проверка источника запроса",
  })
  @ApiUnauthorizedResponse({
    description: "Refresh token отсутствует или недействителен",
  })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResponseDto> {
    const session = await this.authService.refresh(getRefreshToken(request));
    return this.completeAuthentication(response, session);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth("access-token")
  @ApiOkResponse({ type: UserResponseDto })
  @ApiUnauthorizedResponse({
    description: "Access token отсутствует или недействителен",
  })
  me(@Req() request: AuthenticatedRequest): UserResponseDto {
    return { user: request.user };
  }

  @Post("logout")
  @UseGuards(AuthRequestGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiHeader({
    name: AUTH_REQUEST_HEADER,
    required: true,
    example: AUTH_REQUEST_HEADER_VALUE,
  })
  @ApiCookieAuth(REFRESH_TOKEN_SECURITY_NAME)
  @ApiNoContentResponse({ description: "Refresh-сессия отозвана" })
  @ApiForbiddenResponse({
    description: "Не пройдена проверка источника запроса",
  })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.authService.logout(getRefreshToken(request));
    response.clearCookie(
      REFRESH_TOKEN_COOKIE_NAME,
      getRefreshTokenCookieClearOptions(this.isProduction()),
    );
  }

  private completeAuthentication(
    response: Response,
    session: SessionResult,
  ): AuthResponseDto {
    response.cookie(
      REFRESH_TOKEN_COOKIE_NAME,
      session.refreshToken,
      this.getRefreshCookieOptions(),
    );

    return {
      accessToken: session.accessToken,
      user: session.user,
    };
  }

  private getRefreshCookieOptions() {
    return getRefreshTokenCookieOptions(
      this.isProduction(),
      this.configService.getOrThrow<number>("JWT_REFRESH_TTL_SECONDS"),
    );
  }

  private isProduction(): boolean {
    return this.configService.get<string>("NODE_ENV") === "production";
  }
}
