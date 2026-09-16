import type { CookieOptions } from "express";

export const REFRESH_TOKEN_COOKIE_NAME = "inspector_refresh_token";
export const REFRESH_TOKEN_SECURITY_NAME = "refresh-token";
export const AUTH_REQUEST_HEADER = "x-inspector-request";
export const AUTH_REQUEST_HEADER_VALUE = "1";
export const AUTH_TOKEN_ISSUER = "inspector-ai-api";
export const ACCESS_TOKEN_AUDIENCE = "inspector-ai-web";
export const REFRESH_TOKEN_AUDIENCE = "inspector-ai-refresh";
export const JWT_ALGORITHM = "HS256" as const;

export const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 20 * 60;
export const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export function getRefreshTokenCookieClearOptions(
  isProduction: boolean,
): CookieOptions {
  return {
    httpOnly: true,
    path: "/api/auth",
    sameSite: "lax",
    secure: isProduction,
  };
}

export function getRefreshTokenCookieOptions(
  isProduction: boolean,
  refreshTokenTtlSeconds: number,
): CookieOptions {
  return {
    ...getRefreshTokenCookieClearOptions(isProduction),
    maxAge: refreshTokenTtlSeconds * 1000,
  };
}
