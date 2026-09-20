import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { PrivateStorageService } from "../../infrastructure/storage/private-storage.service.js";
import {
  MAX_ARTIFACT_BYTES,
  ParsingError,
  validateArtifact,
  type ArtifactValidationMode,
  type ParseArtifactData,
} from "./parsing-contract.js";

@Injectable()
export class ArtifactStorageService {
  constructor(private readonly storage: PrivateStorageService) {}

  async readBytes(key: string, limit = MAX_ARTIFACT_BYTES) {
    const path = this.storage.path("derived", key);
    const info = await lstat(path);
    if (!info.isFile() || info.size > limit)
      throw new ParsingError("artifact_integrity_failed", false);
    const chunks: Buffer[] = [];
    let length = 0;
    for await (const data of createReadStream(path)) {
      const chunk = data as Buffer;
      length += chunk.length;
      if (length > limit)
        throw new ParsingError("artifact_integrity_failed", false);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async read(
    storageKey: string,
    digest: string,
    sourceHash: string,
    fingerprint: string,
    mode: ArtifactValidationMode = "strict",
  ) {
    const bytes = await this.readBytes(storageKey);
    if (createHash("sha256").update(bytes).digest("hex") !== digest)
      throw new ParsingError("artifact_integrity_failed", false);
    return validateArtifact(
      JSON.parse(bytes.toString("utf8")) as unknown,
      sourceHash,
      fingerprint,
      mode,
    );
  }

  async verifyImages(artifact: ParseArtifactData, signal?: AbortSignal) {
    // Do not load all rendered pages at once. Hash and verify the exact image the
    // viewer will display, including its dimensions, before publishing locators.
    for (const page of artifact.pages) {
      if (signal?.aborted) throw new ParsingError("parser_timeout", true);
      await this.image(page);
    }
  }

  async image(page: ParseArtifactData["pages"][number]) {
    const bytes = await this.readBytes(page.image_key);
    if (
      bytes.length < 24 ||
      !bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      bytes.toString("ascii", 12, 16) !== "IHDR" ||
      bytes.readUInt32BE(16) !== page.transform.render_width ||
      bytes.readUInt32BE(20) !== page.transform.render_height ||
      createHash("sha256").update(bytes).digest("hex") !== page.image_sha256
    )
      throw new ParsingError("artifact_integrity_failed", false);
    return bytes;
  }

  async write(artifact: ParseArtifactData) {
    const bytes = Buffer.from(JSON.stringify(artifact));
    if (bytes.length > MAX_ARTIFACT_BYTES)
      throw new ParsingError("parser_resource_limit", false);
    const key = await this.storage.writeDerived(Readable.from([bytes]));
    if (process.platform !== "win32") {
      const directory = await open(
        dirname(this.storage.path("derived", key)),
        "r",
      );
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
    return {
      storageKey: key,
      artifactSha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }
}
