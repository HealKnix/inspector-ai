import {
  BadRequestException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { isUUID } from "class-validator";
import { createHash } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import Parser from "stream-json/Parser.js";
import type { PrivateStorageService } from "../../infrastructure/storage/private-storage.service.js";

export const FILE_LIMIT = 50_000_000;
export const PACKAGE_LIMIT = 200_000_000;
export const WIRE_LIMIT = 270_000_000;
export interface ReceivedFile {
  client_file_id: string;
  original_name: string;
  key: string;
  size: number;
  sha256: string;
}
export interface ReceivedUpload {
  object_id: string;
  process_id?: string;
  client_upload_id: string;
  files: ReceivedFile[];
}
interface Token {
  name: string;
  value?: string;
}

export async function receiveUpload(
  source: Readable,
  storage: PrivateStorageService,
  signal?: AbortSignal,
): Promise<ReceivedUpload> {
  const root: Record<string, string> = {};
  const files: ReceivedFile[] = [];
  const temporaryKeys: string[] = [];
  const stack: string[] = [];
  const rootKeys = new Set<string>();
  let fileKeys = new Set<string>();
  let file: Record<string, string> = {};
  let handle: FileHandle | undefined;
  let temporaryKey = "";
  let fileSize = 0;
  let packageSize = 0;
  let wireSize = 0;
  let metadataSize = 0;
  let key = "";
  let text = "";
  let readingKey = false;
  let base64 = "";
  let hash = createHash("sha256");
  const invalid = () =>
    new BadRequestException("Некорректный JSON-пакет или base64");

  async function decode(value: string, final: boolean) {
    base64 += value;
    // The tokenizer emits 256-character tokens. Batch them into bounded writes.
    if (!final && base64.length < 65_540) return;
    const length = final
      ? base64.length
      : Math.max(0, Math.floor(base64.length / 4) * 4 - 4);
    const part = base64.slice(0, length);
    base64 = base64.slice(length);
    if (!part && !final) return;
    if (
      part.length % 4 !== 0 ||
      !(
        final
          ? /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
          : /^[A-Za-z0-9+/]*$/
      ).test(part)
    )
      throw invalid();
    const bytes = Buffer.from(part, "base64");
    if (final && bytes.toString("base64") !== part) throw invalid();
    fileSize += bytes.length;
    packageSize += bytes.length;
    if (packageSize > PACKAGE_LIMIT)
      throw new PayloadTooLargeException(
        "Пакет превышает 200 МБ. Ни один файл не принят.",
      );
    hash.update(bytes);
    if (handle && fileSize <= FILE_LIMIT) await handle.write(bytes);
  }

  async function token(t: Token) {
    const level = stack.at(-1);
    if (t.name === "startObject") {
      if (!level && rootKeys.size === 0) stack.push("root");
      else if (level === "files" && files.length < 1000) {
        stack.push("file");
        file = {};
        fileKeys = new Set();
        fileSize = 0;
        hash = createHash("sha256");
        const temporary = await storage.temporary();
        handle = temporary.handle;
        temporaryKey = temporary.key;
        temporaryKeys.push(temporaryKey);
      } else throw invalid();
    } else if (t.name === "startArray") {
      if (level !== "root" || key !== "files") throw invalid();
      stack.push("files");
    } else if (t.name === "endArray") {
      if (level !== "files") throw invalid();
      stack.pop();
    } else if (t.name === "endObject") {
      if (level === "file") {
        await handle?.close();
        handle = undefined;
        if (
          fileKeys.size !== 3 ||
          !fileKeys.has("content_base64") ||
          !file.client_file_id ||
          !file.original_name ||
          !isUUID(file.client_file_id) ||
          file.original_name.length > 512
        )
          throw invalid();
        files.push({
          client_file_id: file.client_file_id,
          original_name: file.original_name,
          key: temporaryKey,
          size: fileSize,
          sha256: hash.digest("hex"),
        });
      } else if (level !== "root") throw invalid();
      stack.pop();
    } else if (t.name === "startKey") {
      readingKey = true;
      text = "";
    } else if (t.name === "endKey") {
      key = text;
      readingKey = false;
      const allowed =
        level === "root"
          ? ["object_id", "process_id", "client_upload_id", "files"]
          : ["client_file_id", "original_name", "content_base64"];
      const keys = level === "root" ? rootKeys : fileKeys;
      if (!allowed.includes(key) || keys.has(key)) throw invalid();
      keys.add(key);
    } else if (t.name === "startString") {
      text = "";
      base64 = "";
    } else if (t.name === "stringChunk") {
      const value = t.value ?? "";
      if (!readingKey && level === "file" && key === "content_base64")
        await decode(value, false);
      else {
        text += value;
        metadataSize += value.length;
        if (text.length > 1024 || metadataSize > 1_000_000) throw invalid();
      }
    } else if (t.name === "endString") {
      if (level === "file" && key === "content_base64") await decode("", true);
      else if (level === "file") file[key] = text;
      else if (level === "root" && key !== "files") root[key] = text;
      else throw invalid();
    } else throw invalid();
  }

  try {
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        wireSize += chunk.length;
        callback(
          wireSize > WIRE_LIMIT
            ? new PayloadTooLargeException("Превышен размер HTTP-пакета")
            : null,
          chunk,
        );
      },
    });
    const sink = new Writable({
      objectMode: true,
      write(value: Token, _encoding, callback) {
        void token(value).then(() => callback(), callback);
      },
    });
    await pipeline(
      Readable.from(source.iterator({ destroyOnReturn: false })),
      counter,
      new Parser({ packValues: false }),
      sink,
      { signal },
    );
    if (
      !root.object_id ||
      !isUUID(root.object_id) ||
      !root.client_upload_id ||
      !isUUID(root.client_upload_id) ||
      (root.process_id !== undefined && !isUUID(root.process_id)) ||
      files.length === 0 ||
      !rootKeys.has("files") ||
      new Set(files.map((item) => item.client_file_id)).size !== files.length
    )
      throw invalid();
    return {
      object_id: root.object_id,
      client_upload_id: root.client_upload_id,
      ...(root.process_id ? { process_id: root.process_id } : {}),
      files,
    };
  } catch (error) {
    source.resume();
    await handle?.close();
    await Promise.all(temporaryKeys.map((item) => storage.discard(item)));
    if (
      error instanceof BadRequestException ||
      error instanceof PayloadTooLargeException
    )
      throw error;
    if (
      error instanceof Error &&
      "code" in error &&
      [
        "ENOSPC",
        "EIO",
        "EACCES",
        "EROFS",
        "EMFILE",
        "ENFILE",
        "ENOENT",
        "ENOTDIR",
        "EEXIST",
      ].includes(String(error.code))
    )
      throw new ServiceUnavailableException(
        "Временное хранилище недоступно. Файлы не приняты; повторите запрос позже с тем же ключом.",
      );
    throw new BadRequestException(
      "Передача не завершена или JSON некорректен. Файлы не приняты.",
    );
  }
}
