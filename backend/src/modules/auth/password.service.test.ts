import { describe, expect, it } from "vitest";

import { PasswordService } from "./password.service.js";

describe("PasswordService", () => {
  const service = new PasswordService();

  it("проверяет пароль по стойкому хешу", async () => {
    const password = "correct-horse-2026";
    const hash = await service.hash(password);

    await expect(service.verify(password, hash)).resolves.toBe(true);
    expect(hash).toMatch(/^scrypt\$1\$131072\$8\$1\$/);
    expect(hash).not.toContain(password);
  });

  it("отклоняет другой пароль и повреждённый хеш", async () => {
    const hash = await service.hash("correct-horse-2026");

    await expect(service.verify("wrong-password", hash)).resolves.toBe(false);
    await expect(
      service.verify("correct-horse-2026", "broken-value"),
    ).resolves.toBe(false);
    await expect(
      service.verify("correct-horse-2026", hash.replace("$131072$", "$16384$")),
    ).resolves.toBe(false);
  });
});
