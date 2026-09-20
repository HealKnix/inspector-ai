import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  constants,
  copyFile,
  mkdir,
  open,
  readdir,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import { join, resolve } from "node:path";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class PrivateStorageService {
  readonly root: string;
  constructor(config: ConfigService) {
    this.root = resolve(
      config.get<string>("STORAGE_ROOT") ?? "./var/documents",
    );
  }

  path(area: "quarantine" | "originals" | "derived", key: string) {
    if (!UUID.test(key)) throw new Error("Invalid storage handle");
    return join(this.root, area, key);
  }

  async temporary() {
    await mkdir(join(this.root, "quarantine"), {
      recursive: true,
      mode: 0o700,
    });
    const key = randomUUID();
    const path = this.path("quarantine", key);
    const handle = await open(path, "wx", 0o600);
    return { key, path, handle };
  }

  async publish(temporaryKey: string) {
    await mkdir(join(this.root, "originals"), { recursive: true, mode: 0o700 });
    const key = randomUUID();
    await copyFile(
      this.path("quarantine", temporaryKey),
      this.path("originals", key),
      constants.COPYFILE_EXCL,
    );
    const handle = await open(this.path("originals", key), "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (process.platform !== "win32") {
      const directory = await open(join(this.root, "originals"), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
    return key;
  }

  async hash(key: string) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(this.path("originals", key)))
      hash.update(chunk as Buffer);
    return hash.digest("hex");
  }

  read(key: string) {
    return createReadStream(this.path("originals", key));
  }
  async discard(key: string) {
    await rm(this.path("quarantine", key), { force: true });
  }

  // Only the admission that generated this handle may discard it, after a successful
  // transaction confirmed it was not referenced. Uncertain commits use stale cleanup.
  async discardUncommittedOriginal(key: string) {
    await rm(this.path("originals", key), { force: true });
  }

  // PAR owns derived metadata. A separate area and handle cannot replace originals.
  async writeDerived(data: AsyncIterable<Uint8Array>) {
    await mkdir(join(this.root, "derived"), { recursive: true, mode: 0o700 });
    const key = randomUUID();
    const path = this.path("derived", key);
    const handle = await open(path, "wx", 0o600);
    try {
      for await (const chunk of data) await handle.writeFile(chunk);
      await handle.sync();
    } catch (error) {
      await handle.close();
      await rm(path, { force: true });
      throw error;
    }
    await handle.close();
    return key;
  }

  async cleanup(
    area: "quarantine" | "originals",
    isReferenced: (key: string) => Promise<boolean>,
  ) {
    const directory = join(this.root, area);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !UUID.test(entry.name)) continue;
      const path = this.path(area, entry.name);
      const info = await stat(path);
      // Admission has a 10 minute deadline. Only stale, unreferenced handles qualify.
      if (
        Date.now() - info.mtimeMs > 86_400_000 &&
        !(await isReferenced(entry.name))
      )
        await unlink(path);
    }
  }
}
