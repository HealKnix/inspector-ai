import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { PrivateStorageService } from "../../infrastructure/storage/private-storage.service.js";
import { fingerprint } from "./document-admission.service.js";
import { receiveUpload } from "./upload-stream.js";

const directories: string[] = [];
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "ingestion-unit-"));
  directories.push(root);
  return new PrivateStorageService(new ConfigService({ STORAGE_ROOT: root }));
}
afterEach(async () => {
  for (const path of directories.splice(0)) {
    if (
      dirname(resolve(path)) !== resolve(tmpdir()) ||
      !basename(path).startsWith("ingestion-unit-")
    )
      throw new Error("Unexpected test cleanup target");
    await rm(path, { recursive: true, force: true });
  }
});
function body(content = Buffer.from("<test/>")) {
  return {
    object_id: randomUUID(),
    client_upload_id: randomUUID(),
    files: [
      {
        client_file_id: randomUUID(),
        original_name: "../synthetic.xml",
        content_base64: content.toString("base64"),
      },
    ],
  };
}

describe("streamed admission", () => {
  it("reports unavailable quarantine as a retryable service failure instead of invalid JSON", async () => {
    const storage = await setup();
    await writeFile(
      join(storage.root, "quarantine"),
      "synthetic blocked directory",
    );
    await expect(
      receiveUpload(Readable.from([JSON.stringify(body())]), storage),
    ).rejects.toMatchObject({ status: 503 });
  });
  it("decodes across single-byte boundaries without trusting the filename", async () => {
    const storage = await setup();
    const data = Buffer.from("<test>Синтетический документ</test>");
    const input = body(data);
    const result = await receiveUpload(
      Readable.from(
        [...Buffer.from(JSON.stringify(input))].map((byte) =>
          Buffer.from([byte]),
        ),
      ),
      storage,
    );
    expect(result.files[0]?.sha256).toBe(
      createHash("sha256").update(data).digest("hex"),
    );
    expect(
      await readFile(storage.path("quarantine", result.files[0]!.key)),
    ).toEqual(data);
    expect(await readdir(storage.root)).toEqual(["quarantine"]);
  });

  it.each(["AA=A", "YQ==AAAA", "YR==", "@@@@", "YQ="])(
    "rejects malformed/canonical-invalid base64 %s and cleans quarantine",
    async (content_base64) => {
      const storage = await setup();
      const input = body();
      input.files[0]!.content_base64 = content_base64;
      await expect(
        receiveUpload(Readable.from([JSON.stringify(input)]), storage),
      ).rejects.toThrow();
      expect(await readdir(join(storage.root, "quarantine"))).toHaveLength(0);
    },
  );

  it("rejects duplicate keys and aborted JSON without retaining temporary files", async () => {
    const storage = await setup();
    const input = JSON.stringify(body());
    for (const invalid of [
      input.slice(0, -3),
      input.replace('"object_id":', '"object_id":"x","object_id":'),
    ])
      await expect(
        receiveUpload(Readable.from([invalid]), storage),
      ).rejects.toThrow();
    expect(await readdir(join(storage.root, "quarantine"))).toHaveLength(0);
  });

  it("canonicalizes file ordering and includes optional process in the fingerprint", async () => {
    const storage = await setup();
    const input = body();
    input.files.push({ ...input.files[0]!, client_file_id: randomUUID() });
    const upload = await receiveUpload(
      Readable.from([JSON.stringify(input)]),
      storage,
    );
    expect(fingerprint(upload)).toBe(
      fingerprint({ ...upload, files: [...upload.files].reverse() }),
    );
    expect(fingerprint(upload)).not.toBe(
      fingerprint({ ...upload, process_id: randomUUID() }),
    );
  });
});
