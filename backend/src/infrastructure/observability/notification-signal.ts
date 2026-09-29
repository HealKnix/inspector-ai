import type { Outbox } from "../../generated/prisma/client.js";
import { record, storedTrace, uuid } from "./trace-context.js";

// Existing producer names; adding a name requires its durable producer contract.
export const NOTIFICATION_EVENTS = [
  "protocol.generated",
  "parsing.failed",
  "file.integrity-failed",
  "documents.admission.rejected",
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];
export interface NotificationSignal {
  schema_version: 1;
  event_id: string;
  event_type: NotificationEvent;
  occurred_at: string;
  correlation_id: string;
  object_id: string;
  run_id: string | null;
  protocol_id: string | null;
  file_id: string | null;
  // An audience is not a recipient or permission grant; delivery resolves both.
  audience: "object-inspector" | "configured-operator";
}
export interface NotificationDeliveryPort {
  deliver(
    signal: NotificationSignal,
    destinationId: string,
    idempotencyKey: string,
  ): Promise<{ accepted: boolean; receiptId: string | null }>;
}

/** Safe producer/consumer boundary, intentionally does not claim delivery. */
export function notificationSignal(
  event: Pick<Outbox, "id" | "eventType" | "payload" | "createdAt">,
): NotificationSignal | null {
  const type = NOTIFICATION_EVENTS.find((name) => name === event.eventType);
  if (!type || !record(event.payload) || !uuid(event.payload.object_id))
    return null;
  const objectId = uuid(event.payload.object_id);
  if (!objectId) return null;
  return {
    schema_version: 1,
    event_id: event.id,
    event_type: type,
    occurred_at: event.createdAt.toISOString(),
    correlation_id: storedTrace(event.payload, event.id).correlation_id,
    object_id: objectId,
    run_id: uuid(event.payload.run_id),
    protocol_id: uuid(event.payload.protocol_id),
    file_id: uuid(event.payload.file_id),
    audience:
      type === "protocol.generated"
        ? "object-inspector"
        : "configured-operator",
  };
}
