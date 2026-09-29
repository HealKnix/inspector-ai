import type { LoggerService } from "@nestjs/common";
import { record, traceContext, uuid } from "./trace-context.js";

const ids = new Set([
  "event_id",
  "run_id",
  "process_id",
  "object_id",
  "file_id",
  "task_id",
  "job_id",
]);
const numbers = new Set([
  "duration_ms",
  "http_status",
  "attempt",
  "attempts",
  "decoded_bytes",
  "count",
]);

export function logRecord(level: string, message: unknown, service: string) {
  let value: unknown = message;
  if (typeof message === "string" && message.startsWith("{")) {
    try {
      value = JSON.parse(message) as unknown;
    } catch {
      value = null;
    }
  }
  const input = record(value) ? value : {};
  const event = input.event ?? input.message;
  const trace = traceContext.getStore();
  const output: Record<string, unknown> = {
    schema_version: 1,
    timestamp: new Date().toISOString(),
    level,
    service,
    message:
      typeof event === "string" && /^[a-z][a-z0-9_.-]{1,100}$/.test(event)
        ? event
        : "runtime.message",
    request_id: trace?.request_id ?? uuid(input.request_id),
    correlation_id: trace?.correlation_id ?? uuid(input.request_id),
    user_id: trace?.actor_kind === "user" ? trace.user_id : null,
    actor_kind: trace?.actor_kind ?? "service",
  };
  for (const [key, item] of Object.entries(input)) {
    if (ids.has(key) && uuid(item)) output[key] = item;
    if (numbers.has(key) && typeof item === "number" && Number.isFinite(item))
      output[key] = item;
    if (key === "exhausted" && typeof item === "boolean") output[key] = item;
  }
  // No Error.message/stack, arbitrary strings, headers, payloads, URLs or paths.
  return output;
}

export class StructuredLogger implements LoggerService {
  constructor(
    private readonly service = "api",
    private readonly sink: (line: string) => void = (line) =>
      process.stdout.write(line + "\n"),
  ) {
    if (!/^[a-z][a-z0-9-]{0,39}$/.test(service))
      throw new Error("Invalid OBS service name");
  }
  private write(level: string, message: unknown) {
    this.sink(JSON.stringify(logRecord(level, message, this.service)));
  }
  log(message: unknown) {
    this.write("INFO", message);
  }
  warn(message: unknown) {
    this.write("WARNING", message);
  }
  error(message: unknown) {
    this.write("ERROR", message);
  }
  fatal(message: unknown) {
    this.write("ERROR", message);
  }
  debug(message: unknown) {
    if (process.env.NODE_ENV !== "production") this.write("DEBUG", message);
  }
  verbose(message: unknown) {
    this.debug(message);
  }
}
