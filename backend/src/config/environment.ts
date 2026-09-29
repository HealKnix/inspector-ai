import {
  DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
  DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
} from "../common/const/auth.constants.js";
import { readSectionAnalysisConfig } from "../modules/extraction/section-config.js";
import { readClassificationConfig } from "../modules/identification/classification-config.js";

type NodeEnvironment = "development" | "production" | "test";

function readRequiredString(
  config: Record<string, unknown>,
  key: string,
): string {
  const value = config[key];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Переменная окружения ${key} обязательна`);
  }

  return value.trim();
}

function readNodeEnvironment(value: unknown): NodeEnvironment {
  if (value === undefined) {
    return "development";
  }

  if (value === "development" || value === "production" || value === "test") {
    return value;
  }

  throw new Error("NODE_ENV должен быть development, production или test");
}

function readPort(value: unknown): number {
  const port = value === undefined ? 3000 : Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT должен быть целым числом от 1 до 65535");
  }

  return port;
}

function readProxyHops(value: unknown): number {
  const hops = value === undefined ? 0 : Number(value);

  if (!Number.isInteger(hops) || hops < 0 || hops > 5) {
    throw new Error("TRUST_PROXY_HOPS должен быть целым числом от 0 до 5");
  }

  return hops;
}

function readFileValidatorTimeout(value: unknown): number {
  const normalized = typeof value === "string" ? value.trim() : value;
  const timeout =
    normalized === undefined
      ? 180
      : typeof normalized === "number" ||
          (typeof normalized === "string" && /^\d+$/.test(normalized))
        ? Number(normalized)
        : Number.NaN;

  if (!Number.isInteger(timeout) || timeout < 25 || timeout > 300) {
    throw new Error(
      "FILE_VALIDATOR_TIMEOUT_SECONDS должен быть целым числом от 25 до 300",
    );
  }

  return timeout;
}

function readDurationSeconds(
  value: unknown,
  key: string,
  defaultValue: number,
): number {
  if (value === undefined) {
    return defaultValue;
  }

  const normalizedValue =
    typeof value === "string" ? value.trim().toLowerCase() : value;
  let duration: number;

  if (typeof normalizedValue === "number") {
    duration = Number(normalizedValue);
  } else if (typeof normalizedValue === "string") {
    if (/^\d+$/.test(normalizedValue)) {
      duration = Number(normalizedValue);
    } else {
      const match = /^(\d+(?:\.\d+)?)\s*(s|m|h|d|w)$/.exec(normalizedValue);

      if (!match) {
        throw new Error(`${key} должен иметь формат 900s, 15m, 2h, 7d или 1w`);
      }

      const amount = Number(match[1]);
      const unit = match[2];
      const multipliers: Record<string, number> = {
        d: 24 * 60 * 60,
        h: 60 * 60,
        m: 60,
        s: 1,
        w: 7 * 24 * 60 * 60,
      };
      duration =
        amount * (unit ? (multipliers[unit] ?? Number.NaN) : Number.NaN);
    }
  } else {
    duration = Number.NaN;
  }

  if (!Number.isInteger(duration) || duration < 1 || duration > 31_536_000) {
    throw new Error(`${key} должен задавать от 1 секунды до 365 дней`);
  }

  return duration;
}

function readFrontendUrl(value: unknown): string {
  const url = typeof value === "string" ? value : "http://localhost:5173";

  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new Error();
    }
  } catch {
    throw new Error("FRONTEND_URL должен быть корректным HTTP(S) URL");
  }

  return url;
}

export function validateEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
  readClassificationConfig(config);
  readSectionAnalysisConfig(config);
  if (
    config.METRICS_TOKEN !== undefined &&
    config.METRICS_TOKEN !== "" &&
    (typeof config.METRICS_TOKEN !== "string" ||
      !/^[A-Za-z0-9+/_=.-]{32,256}$/.test(config.METRICS_TOKEN))
  ) {
    throw new Error(
      "METRICS_TOKEN должен содержать 32–256 допустимых символов без пробелов",
    );
  }
  const jwtSecret = readRequiredString(config, "JWT_SECRET");
  const jwtRefreshSecret = readRequiredString(config, "JWT_REFRESH_SECRET");

  if (jwtSecret.length < 32) {
    throw new Error("JWT_SECRET должен содержать не менее 32 символов");
  }

  if (jwtRefreshSecret.length < 32) {
    throw new Error("JWT_REFRESH_SECRET должен содержать не менее 32 символов");
  }

  if (jwtSecret === jwtRefreshSecret) {
    throw new Error("JWT_SECRET и JWT_REFRESH_SECRET должны отличаться");
  }

  const accessTokenTtlSeconds = readDurationSeconds(
    config.JWT_ACCESS_TTL ?? config.JWT_ACCESS_TTL_SECONDS,
    "JWT_ACCESS_TTL",
    DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
  );
  const refreshTokenTtlSeconds = readDurationSeconds(
    config.JWT_REFRESH_TTL ?? config.JWT_REFRESH_TTL_SECONDS,
    "JWT_REFRESH_TTL",
    DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
  );
  if (accessTokenTtlSeconds >= refreshTokenTtlSeconds) {
    throw new Error("JWT_ACCESS_TTL должен быть меньше JWT_REFRESH_TTL");
  }

  return {
    ...config,
    JWT_ACCESS_TTL_SECONDS: accessTokenTtlSeconds,
    JWT_REFRESH_SECRET: jwtRefreshSecret,
    JWT_REFRESH_TTL_SECONDS: refreshTokenTtlSeconds,
    DATABASE_URL: readRequiredString(config, "DATABASE_URL"),
    FRONTEND_URL: readFrontendUrl(config.FRONTEND_URL),
    JWT_SECRET: jwtSecret,
    NODE_ENV: readNodeEnvironment(config.NODE_ENV),
    PORT: readPort(config.PORT),
    TRUST_PROXY_HOPS: readProxyHops(config.TRUST_PROXY_HOPS),
    STORAGE_ROOT:
      typeof config.STORAGE_ROOT === "string" && config.STORAGE_ROOT.trim()
        ? config.STORAGE_ROOT
        : "./var/documents",
    CLAMAV_HOST:
      typeof config.CLAMAV_HOST === "string" && config.CLAMAV_HOST.trim()
        ? config.CLAMAV_HOST
        : "127.0.0.1",
    CLAMAV_PORT: readPort(config.CLAMAV_PORT ?? 3310),
    FILE_VALIDATOR_URL: readFrontendUrl(
      config.FILE_VALIDATOR_URL ?? "http://127.0.0.1:8081",
    ),
    FILE_VALIDATOR_TIMEOUT_SECONDS: readFileValidatorTimeout(
      config.FILE_VALIDATOR_TIMEOUT_SECONDS,
    ),
    RABBITMQ_URL: config.RABBITMQ_URL ?? "amqp://guest:guest@127.0.0.1:5672",
  };
}
