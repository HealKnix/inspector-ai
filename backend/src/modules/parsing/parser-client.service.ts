import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  HASH,
  MAX_ARTIFACT_BYTES,
  ParsingError,
  record,
} from "./parsing-contract.js";
import { parserProgress } from "./parsing-progress.js";

export function isParserNotAdmitted(error: unknown): error is ParsingError {
  return (
    error instanceof ParsingError &&
    error.retryable &&
    !error.admitted &&
    (error.code === "parser_busy" || error.code === "models_not_ready")
  );
}

@Injectable()
export class ParserClientService {
  readonly timeoutMs: number;
  readonly modelsReadyWaitMs: number;
  private readonly url: string;
  private readonly token: string;
  constructor(config: ConfigService) {
    this.url = config.get<string>("PARSER_URL") ?? "http://127.0.0.1:8090";
    this.token = config.get<string>("PARSER_TOKEN") ?? "";
    const seconds = Number(config.get("PARSER_FILE_TIMEOUT_SECONDS") ?? 600);
    const readySeconds = Number(
      config.get("PARSER_MODEL_READY_WAIT_SECONDS") ?? 300,
    );
    if (
      !Number.isInteger(seconds) ||
      seconds < 1 ||
      seconds > 3600 ||
      !Number.isInteger(readySeconds) ||
      readySeconds < 30 ||
      readySeconds > 1800 ||
      !["http:", "https:"].includes(new URL(this.url).protocol)
    )
      throw new Error("Invalid parser configuration");
    this.timeoutMs = seconds * 1000 + 10_000;
    this.modelsReadyWaitMs = readySeconds * 1000;
  }
  private headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
  }
  async fingerprint() {
    try {
      const response = await fetch(`${this.url}/health`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(5000),
      });
      const body: unknown = await response.json();
      if (
        response.status === 503 &&
        record(body) &&
        body.code === "models_not_ready" &&
        body.retryable === true
      )
        throw new ParsingError("models_not_ready", true);
      if (
        !response.ok ||
        !record(body) ||
        body.status !== "ok" ||
        typeof body.pipeline_fingerprint !== "string" ||
        !HASH.test(body.pipeline_fingerprint)
      )
        throw new Error();
      return body.pipeline_fingerprint;
    } catch (error) {
      if (isParserNotAdmitted(error)) throw error;
      throw new ParsingError("parser_unavailable", true);
    }
  }
  async parse(
    input: {
      request_id: string;
      storage_key: string;
      source_sha256: string;
      format: string;
    },
    signal: AbortSignal,
    fingerprint: string,
  ): Promise<unknown> {
    let requestStarted = false;
    let acceptedResponse = false;
    try {
      if (!this.token)
        throw new ParsingError("parser_configuration_missing", false);
      requestStarted = true;
      // Bun's socket idle timer is separate from the bounded whole-file deadline.
      // OCR sends no response bytes until completion, so only the caller's signal
      // should time it out: https://bun.com/reference/globals/BunFetchRequestInit/timeout
      const options: NonNullable<Parameters<typeof fetch>[1]> & {
        timeout: false;
      } = {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ schema_version: 1, ...input }),
        signal,
        timeout: false,
      };
      const response = await fetch(`${this.url}/parse`, options);
      if (!response.ok) {
        const error: unknown = await response.json();
        if (
          record(error) &&
          typeof error.code === "string" &&
          /^[a-z0-9_]{1,80}$/.test(error.code) &&
          typeof error.retryable === "boolean"
        ) {
          // Only the explicit 503 readiness response proves non-admission.
          if (error.code === "models_not_ready" && response.status !== 503)
            throw new ParsingError(
              "parser_unavailable",
              response.status >= 500,
            );
          const admitted =
            error.admitted === true &&
            error.request_id === input.request_id &&
            error.pipeline_fingerprint === fingerprint &&
            HASH.test(fingerprint);
          throw new ParsingError(error.code, error.retryable, admitted);
        }
        throw new ParsingError("parser_unavailable", response.status >= 500);
      }
      acceptedResponse = true;
      if (!response.body)
        throw new ParsingError("parser_invalid_result", false);
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          const bytes: unknown = chunk.value;
          if (!(bytes instanceof Uint8Array))
            throw new ParsingError("parser_invalid_result", false);
          size += bytes.length;
          if (size > MAX_ARTIFACT_BYTES) {
            await reader.cancel();
            throw new ParsingError("parser_resource_limit", false);
          }
          chunks.push(bytes);
        }
      } finally {
        reader.releaseLock();
      }
      try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
      } catch {
        throw new ParsingError("parser_invalid_result", false);
      }
    } catch (error) {
      // A transport failure may arrive after Python accepted the request. Cancel
      // its UUID even when fetch failed without aborting our own deadline signal.
      // Capacity/readiness refusals never admitted this request.
      const cancelled =
        requestStarted && !isParserNotAdmitted(error)
          ? await this.cancel(input.request_id)
          : false;
      if (error instanceof ParsingError) {
        if ((cancelled || acceptedResponse) && !error.admitted)
          throw new ParsingError(error.code, error.retryable, true);
        throw error;
      }
      throw new ParsingError(
        signal.aborted ? "parser_timeout" : "parser_unavailable",
        true,
        cancelled || acceptedResponse,
      );
    }
  }
  async progress(requestId: string, fingerprint: string) {
    try {
      const response = await fetch(`${this.url}/progress/${requestId}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(1500),
      });
      const value: unknown = await response.json();
      if (response.ok) return parserProgress(value, requestId, fingerprint);
    } catch {
      /* Progress is informational; failure cannot change task outcome. */
    }
    return null;
  }
  async cancel(requestId: string) {
    try {
      const response = await fetch(`${this.url}/cancel/${requestId}`, {
        method: "POST",
        headers: this.headers(),
        signal: AbortSignal.timeout(3000),
      });
      const value: unknown = await response.json();
      // The authenticated UUID endpoint returns true only after terminating that
      // request's CPU worker. This also proves admission after an ambiguous reset.
      return response.ok && record(value) && value.cancelled === true;
    } catch {
      /* Parser's own hard timeout is independent of the caller connection. */
    }
    return false;
  }
}
