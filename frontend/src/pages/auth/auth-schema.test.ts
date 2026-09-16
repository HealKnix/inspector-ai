import { describe, expect, it } from "vitest";

import { loginSchema, registerSchema } from "./auth-schema";

describe("auth schemas", () => {
  it("нормализует логин перед отправкой", () => {
    const result = loginSchema.parse({
      login: "  Inspector.Ivanov  ",
      password: "existing-password",
    });

    expect(result.login).toBe("inspector.ivanov");
  });

  it("нормализует Unicode и отклоняет невидимый логин", () => {
    const normalized = loginSchema.parse({
      login: "E\u0301quipe",
      password: "existing-password",
    });
    const invisible = loginSchema.safeParse({
      login: "\u200B\u200B\u200B",
      password: "existing-password",
    });

    expect(normalized.login).toBe("équipe");
    expect(invisible.success).toBe(false);
  });

  it("требует надёжный пароль при регистрации", () => {
    const result = registerSchema.safeParse({
      login: "inspector.ivanov",
      password: "short",
      passwordConfirmation: "short",
    });

    expect(result.success).toBe(false);
  });

  it("не принимает разные пароли", () => {
    const result = registerSchema.safeParse({
      login: "inspector.ivanov",
      password: "correct-horse-2026",
      passwordConfirmation: "another-password-2026",
    });

    expect(result.success).toBe(false);
  });
});
