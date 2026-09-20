import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { once } from "node:events";
import { createReadStream } from "node:fs";
import { createConnection } from "node:net";
import { PrivateStorageService } from "./private-storage.service.js";

export type FileFormat = "PDF" | "DOCX" | "XML";
export type SafetyResult =
  { format: FileFormat } | { error: string; message: string };

export function scannerVerdict(
  response: string,
): "clean" | "infected" | "limit" {
  if (response === "stream: OK") return "clean";
  if (/^stream: Heuristics\.Limits\.Exceeded\.[A-Za-z]+ FOUND$/.test(response))
    return "limit";
  if (response.startsWith("stream: ") && response.endsWith(" FOUND"))
    return "infected";
  throw new Error("Scanner did not approve file");
}

@Injectable()
export class FileSafetyService {
  constructor(
    private readonly config: ConfigService,
    private readonly storage: PrivateStorageService,
  ) {}

  private async scan(key: string) {
    const socket = createConnection({
      host: this.config.getOrThrow<string>("CLAMAV_HOST"),
      port: Number(this.config.get("CLAMAV_PORT") ?? 3310),
    });
    // clamd MaxScanTime is explicitly bounded to 120 seconds. Await its verdict.
    socket.setTimeout(130_000, () =>
      socket.destroy(new Error("Scanner timeout")),
    );
    const reply = new Promise<string>((resolve, reject) => {
      let data = "";
      socket.on("error", reject);
      socket.on("close", () => reject(new Error("Scanner closed")));
      socket.on("data", (chunk: Buffer) => {
        data += chunk.toString("utf8");
        if (data.length > 4096)
          socket.destroy(new Error("Invalid scanner response"));
        if (data.includes("\0")) resolve(data.slice(0, data.indexOf("\0")));
      });
    });
    void reply.catch(() => undefined);
    try {
      await once(socket, "connect");
      socket.write("zINSTREAM\0");
      for await (const value of createReadStream(
        this.storage.path("quarantine", key),
        { highWaterMark: 64 * 1024 },
      )) {
        const chunk = value as Buffer;
        const length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.length);
        socket.write(length);
        if (!socket.write(chunk)) await once(socket, "drain");
      }
      socket.write(Buffer.alloc(4));
      return scannerVerdict(await reply);
    } finally {
      socket.destroy();
    }
  }

  async inspect(key: string): Promise<SafetyResult> {
    try {
      const verdict = await this.scan(key);
      if (verdict === "limit")
        return {
          error: "scanner_limit",
          message:
            "Антивирусная проверка превысила лимиты ресурсов. Файл не принят.",
        };
      if (verdict === "infected")
        return { error: "infected", message: "Антивирус обнаружил угрозу" };
    } catch {
      return {
        error: "scanner_unavailable",
        message: "Антивирусная проверка недоступна. Файл не принят.",
      };
    }
    try {
      const timeoutSeconds = Number(
        this.config.get("FILE_VALIDATOR_TIMEOUT_SECONDS") ?? 180,
      );
      const response = await fetch(
        this.config.getOrThrow<string>("FILE_VALIDATOR_URL"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key }),
          // The validator supervisor gets budget +5s; leave time for its reply.
          signal: AbortSignal.timeout((timeoutSeconds + 10) * 1000),
          redirect: "error",
        },
      );
      if (response.status !== 200) {
        await response.body?.cancel();
        throw new Error("Validator unavailable");
      }
      const data: unknown = await response.json();
      // Only an unambiguous completed verdict can accept or reject the format.
      if (
        typeof data !== "object" ||
        data === null ||
        Array.isArray(data) ||
        Object.keys(data).length !== 1
      )
        throw new Error("Invalid validator response");
      if (
        "format" in data &&
        (data.format === "PDF" ||
          data.format === "DOCX" ||
          data.format === "XML")
      )
        return { format: data.format };
      if ("error" in data && data.error === "unsafe_format")
        return {
          error: "unsafe_format",
          message:
            "Формат повреждён, небезопасен или не поддерживается. Разрешены PDF, DOCX и XML.",
        };
      throw new Error("Invalid validator response");
    } catch {
      return {
        error: "validator_unavailable",
        message: "Проверка структуры недоступна. Файл не принят.",
      };
    }
  }
}
