import type { AuditEvent, Prisma } from "../../generated/prisma/client.js";
import { record, traceContext, uuid } from "../observability/trace-context.js";

const idKeys = new Set([
  "file_id",
  "run_id",
  "process_id",
  "protocol_id",
  "finding_id",
  "task_id",
  "document_id",
  "revision_id",
  "part_id",
  "snapshot_id",
  "result_id",
  "initial_user_id",
  "target_user_id",
  "request_id",
  "retry_request_id",
  "rule_id",
  "matrix_id",
  "decision_id",
  "client_upload_id",
  "artifact_id",
  "previous_run_id",
  "rule_version_id",
  "passport_id",
  "report_id",
  "regression_report_id",
]);
const codeKeys = new Set([
  "decision",
  "from_status",
  "to_status",
  "reason_code",
  "error_code",
  "code",
  "parameter_code",
  "scenario",
  "state",
  "actor",
  "kind",
  "field",
  "operation",
]);
const numberKeys = new Set([
  "schema_version",
  "protocol_version",
  "version",
  "cycle",
  "attempts",
  "attempt",
  "findings",
  "carried_decisions",
  "accepted",
  "rejected",
  "duplicates",
  "card_version",
  "before_version",
  "after_version",
  "revision",
]);
const hashKeys = new Set([
  "ruleset_hash",
  "input_manifest_hash",
  "findings_hash",
  "resolved_input_hash",
  "source_fingerprint",
  "before_hash",
  "after_hash",
  "content_hash",
  "passport_hash",
  "report_hash",
  "regression_report_hash",
  "rule_hash",
]);

/** Read allowlist: new producers explicitly extend this contract, never expose raw JSON. */
export function publicAuditDetails(value: unknown): Prisma.InputJsonObject {
  if (!record(value)) return {};
  const result: Record<string, Prisma.InputJsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (idKeys.has(key) && uuid(item)) result[key] = item as string;
    else if (
      codeKeys.has(key) &&
      typeof item === "string" &&
      /^[a-zA-Z0-9_.:-]{1,100}$/.test(item)
    )
      result[key] = item;
    else if (
      numberKeys.has(key) &&
      typeof item === "number" &&
      Number.isSafeInteger(item)
    )
      result[key] = item;
    else if (
      hashKeys.has(key) &&
      typeof item === "string" &&
      /^[a-f0-9]{64}$/i.test(item)
    )
      result[key] = item;
    else if (key === "document_ids" && Array.isArray(item))
      result[key] = item.filter((id): id is string => uuid(id) !== null);
    else if (key === "passed" && typeof item === "boolean") result[key] = item;
    else if (key === "reason_codes" && Array.isArray(item))
      result[key] = item.filter(
        (code): code is string =>
          typeof code === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(code),
      );
  }
  return result;
}

export function safeUserAgent(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 256 ||
    [...value].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    /bearer|token|password|secret|base64/i.test(value)
  )
    return null;
  return value;
}

/** Must receive the caller's transaction. No independent commit or authorization. */
export function writeAuditEvent(
  tx: Prisma.TransactionClient,
  args: Prisma.AuditEventCreateArgs,
) {
  const trace = traceContext.getStore();
  const details =
    record(args.data.details) && !("toJSON" in args.data.details)
      ? args.data.details
      : {};
  return tx.auditEvent.create({
    ...args,
    data: {
      ...args.data,
      ...(trace?.actor_kind === "user" ? { requestId: trace.request_id } : {}),
      details: {
        ...details,
        _audit: {
          schema_version: 1,
          correlation_id: trace?.correlation_id ?? args.data.requestId,
          actor_kind:
            trace?.actor_kind ??
            (typeof details.actor === "string" ? "service" : "user"),
          user_agent:
            trace?.actor_kind === "user"
              ? safeUserAgent(trace.user_agent)
              : null,
        },
      },
    },
  });
}

export function presentAuditEvent(event: AuditEvent) {
  const details = record(event.details) ? event.details : {};
  const metadata = record(details._audit) ? details._audit : {};
  const service =
    metadata.actor_kind === "service" || typeof details.actor === "string";
  return {
    schema_version: 1,
    event_id: event.id,
    action: event.action,
    object_id: event.objectId,
    occurred_at: event.createdAt.toISOString(),
    request_id: event.requestId,
    correlation_id: uuid(metadata.correlation_id),
    actor: {
      kind: service ? "service" : "user",
      user_id: service ? null : event.userId,
      initiated_by: service ? event.userId : null,
    },
    ip_address: event.ip,
    user_agent: safeUserAgent(metadata.user_agent),
    metadata_recorded: metadata.schema_version === 1,
    details: publicAuditDetails(details),
    reason:
      event.action === "protocol.finalization_cancelled" &&
      typeof details.reason === "string"
        ? details.reason
        : null,
  };
}
