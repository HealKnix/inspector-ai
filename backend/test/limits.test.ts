import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { PrivateStorageService } from "../src/infrastructure/storage/private-storage.service.js";
import { receiveUpload } from "../src/modules/documents/upload-stream.js";
import { streamedPackage } from "./streamed-package.js";

describe("decoded byte limits and bounded memory", () => {
  it("accepts 4 × 50,000,000, counts 50,000,001 and rejects total 200,000,001 atomically", async () => {
    const storage = new PrivateStorageService(
      new ConfigService({
        STORAGE_ROOT: resolve("../.test-output/limit-storage", randomUUID()),
      }),
    );
    const baseline = process.memoryUsage().rss;
    let maximum = baseline;
    function* measured(sizes: number[]) {
      for (const part of streamedPackage(randomUUID(), randomUUID(), sizes)) {
        maximum = Math.max(maximum, process.memoryUsage().rss);
        yield part;
      }
    }
    const result = await receiveUpload(
      Readable.from(measured([50_000_000, 50_000_000, 50_000_000, 50_000_000])),
      storage,
    );
    expect(result.files.map((file) => file.size)).toEqual([
      50_000_000, 50_000_000, 50_000_000, 50_000_000,
    ]);
    await Promise.all(result.files.map((file) => storage.discard(file.key)));
    const oversized = await receiveUpload(
      Readable.from(measured([50_000_001])),
      storage,
    );
    expect(oversized.files[0]?.size).toBe(50_000_001);
    await storage.discard(oversized.files[0]!.key);
    await expect(
      receiveUpload(
        Readable.from(
          measured([50_000_000, 50_000_000, 50_000_000, 50_000_001]),
        ),
        storage,
      ),
    ).rejects.toThrow("200 МБ");
    expect(await readdir(resolve(storage.root, "quarantine"))).toEqual([]);
    const growth = maximum - baseline;
    await writeFile(
      resolve("../.test-output/memory.json"),
      JSON.stringify(
        {
          decoded_package_bytes: 200_000_000,
          baseline_rss: baseline,
          peak_rss: maximum,
          growth,
        },
        null,
        2,
      ),
    );
    expect(growth).toBeLessThan(200_000_000);
  }, 180_000);
});
