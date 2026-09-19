import { describe, expect, it } from "vitest";

import { validateEnvironment } from "./environment.js";

const baseEnvironment = {
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/postgres",
  JWT_REFRESH_SECRET: "refresh-secret-with-at-least-32-characters",
  JWT_SECRET: "access-secret-with-at-least-32-characters",
};

describe("validateEnvironment", () => {
  it("uses a 180-second structural validation budget by default", () => {
    expect(
      validateEnvironment(baseEnvironment).FILE_VALIDATOR_TIMEOUT_SECONDS,
    ).toBe(180);
  });

  it.each([
    ["25", 25],
    ["180", 180],
    ["300", 300],
    [120, 120],
  ])("accepts FILE_VALIDATOR_TIMEOUT_SECONDS=%s", (value, expected) => {
    expect(
      validateEnvironment({
        ...baseEnvironment,
        FILE_VALIDATOR_TIMEOUT_SECONDS: value,
      }).FILE_VALIDATOR_TIMEOUT_SECONDS,
    ).toBe(expected);
  });

  it.each(["", "24", "301", "25.5", "3m", "0x40", "NaN", null, true])(
    "rejects an invalid structural validation budget: %s",
    (value) => {
      expect(() =>
        validateEnvironment({
          ...baseEnvironment,
          FILE_VALIDATOR_TIMEOUT_SECONDS: value,
        }),
      ).toThrow("FILE_VALIDATOR_TIMEOUT_SECONDS");
    },
  );

  it.each([
    ["30s", 30],
    ["90s", 90],
    ["15m", 900],
    ["1.5h", 5400],
    ["2d", 172_800],
    ["1w", 604_800],
    ["1200", 1200],
  ])("преобразует JWT_ACCESS_TTL=%s в %i секунд", (value, expected) => {
    const environment = validateEnvironment({
      ...baseEnvironment,
      JWT_ACCESS_TTL: value,
      JWT_REFRESH_TTL: "30d",
    });

    expect(environment.JWT_ACCESS_TTL_SECONDS).toBe(expected);
  });

  it("отклоняет access token со сроком не меньше refresh token", () => {
    expect(() =>
      validateEnvironment({
        ...baseEnvironment,
        JWT_ACCESS_TTL: "7d",
        JWT_REFRESH_TTL: "7d",
      }),
    ).toThrow("JWT_ACCESS_TTL должен быть меньше JWT_REFRESH_TTL");
  });

  it("отклоняет неизвестную единицу времени", () => {
    expect(() =>
      validateEnvironment({ ...baseEnvironment, JWT_ACCESS_TTL: "2months" }),
    ).toThrow("JWT_ACCESS_TTL должен иметь формат");
  });
});
