import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { Prisma } from "../../generated/prisma/client.js";

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export interface TraceContext {
  request_id: string;
  correlation_id: string;
  user_id: string | null;
  actor_kind: "user" | "service";
  user_agent?: string | null;
}
export const traceContext = new AsyncLocalStorage<TraceContext>();
export const currentRequestId = () =>
  traceContext.getStore()?.request_id ?? randomUUID();
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function uuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

export function traceHeaders() {
  const trace = traceContext.getStore();
  return trace
    ? {
        "x-request-id": trace.request_id,
        "x-correlation-id": trace.correlation_id,
      }
    : {};
}

// Queue context is technical metadata, never authorization or a fictitious user.
export function queueTrace(
  headers: unknown,
  messageId?: unknown,
): TraceContext {
  const values = record(headers) ? headers : {};
  const requestId =
    uuid(values["x-request-id"]) ?? uuid(messageId) ?? randomUUID();
  return {
    request_id: requestId,
    correlation_id: uuid(values["x-correlation-id"]) ?? requestId,
    user_id: null,
    actor_kind: "service",
  };
}

export function storedTrace(payload: unknown, eventId: string): TraceContext {
  const values = record(payload) ? payload : {};
  const stored = record(values._trace) ? values._trace : {};
  const requestId =
    uuid(stored.request_id) ?? uuid(values.request_id) ?? eventId;
  return {
    request_id: requestId,
    correlation_id: uuid(stored.correlation_id) ?? requestId,
    user_id: null,
    actor_kind: "service",
  };
}

// The extra key is confined to durable outbox storage and removed before send.
// No migration and no changes to strict business message validators are needed.
export function writeOutboxEvent(
  tx: Prisma.TransactionClient,
  args: Prisma.OutboxCreateArgs,
) {
  const trace = traceContext.getStore();
  const payload = args.data.payload;
  return tx.outbox.create({
    ...args,
    data: {
      ...args.data,
      payload:
        trace && record(payload)
          ? {
              ...payload,
              _trace: {
                request_id: trace.request_id,
                correlation_id: trace.correlation_id,
              },
            }
          : payload,
    },
  });
}

export function businessPayload(payload: Prisma.JsonValue): Prisma.JsonValue {
  if (!record(payload)) return payload;
  const copy = { ...payload };
  delete copy._trace;
  return copy;
}
