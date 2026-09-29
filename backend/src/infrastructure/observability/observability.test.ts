import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  presentAuditEvent,
  publicAuditDetails,
} from "../audit/audit-envelope.js";
import { TechnicalMetrics, metricsAuthorized } from "./metrics.js";
import { notificationSignal } from "./notification-signal.js";
import { StructuredLogger } from "./structured-logger.js";
import { businessPayload, queueTrace, traceContext } from "./trace-context.js";

describe("safe diagnostic boundaries", () => {
  it("does not serialize errors, documents, URLs or arbitrary JSON even inside exceptions", () => {
    const lines: string[] = [],
      logger = new StructuredLogger("parser", (line) => lines.push(line));
    const secret = "SYNTHETIC-TOKEN-NEVER-LOG";
    logger.error(new Error(secret));
    logger.error({
      event: "parser.failed",
      token: secret,
      document: secret,
      headers: { Authorization: secret },
      stack: secret,
      url: `https://example.invalid/${secret}`,
      duration_ms: 7,
    });
    logger.log(
      JSON.stringify({
        event: "parser.finished",
        file_id: randomUUID(),
        payload: { content_base64: secret },
        object_id: secret,
      }),
    );
    expect(lines.join("\n")).not.toContain(secret);
    expect(
      lines.map((line) => JSON.parse(line) as Record<string, unknown>),
    ).toMatchObject([
      { schema_version: 1, message: "runtime.message", user_id: null },
      { message: "parser.failed", duration_ms: 7 },
      { message: "parser.finished" },
    ]);
  });

  it("disables DEBUG/verbose in production", () => {
    const prior = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const lines: string[] = [];
      const logger = new StructuredLogger("api", (line) => lines.push(line));
      logger.debug({ event: "debug.test" });
      logger.verbose({ event: "debug.test" });
      expect(lines).toEqual([]);
    } finally {
      process.env.NODE_ENV = prior;
    }
  });

  it("isolates concurrent async contexts and never trusts a queue user", async () => {
    const ids = [randomUUID(), randomUUID()];
    const results = await Promise.all(
      ids.map((id) =>
        traceContext.run(
          queueTrace({
            "x-request-id": id,
            "x-correlation-id": id,
            user_id: "forged",
          }),
          async () => {
            await Promise.resolve();
            return traceContext.getStore();
          },
        ),
      ),
    );
    expect(results.map((item) => item?.correlation_id)).toEqual(ids);
    expect(
      results.every(
        (item) => item?.user_id === null && item.actor_kind === "service",
      ),
    ).toBe(true);
    expect(traceContext.getStore()).toBeUndefined();
    expect(
      businessPayload({
        schema_version: 1,
        task_id: ids[0]!,
        _trace: { request_id: ids[0]! },
      }),
    ).toEqual({ schema_version: 1, task_id: ids[0] });
  });

  it("projects unknown historic metadata as absent and exposes no arbitrary details", () => {
    const row = presentAuditEvent({
      id: randomUUID(),
      userId: randomUUID(),
      objectId: randomUUID(),
      action: "parsing.failed",
      requestId: randomUUID(),
      ip: null,
      details: {
        actor: "parsing-worker",
        secret: "hidden",
        document: "private",
        error_code: "parser_timeout",
      },
      createdAt: new Date(),
    });
    expect(row).toMatchObject({
      actor: { kind: "service", user_id: null },
      user_agent: null,
      correlation_id: null,
      metadata_recorded: false,
      details: { error_code: "parser_timeout" },
    });
    expect(JSON.stringify(row)).not.toContain("hidden");
    expect(
      publicAuditDetails({
        protocol_id: "secret",
        details: { token: "secret" },
        findings: 7,
      }),
    ).toEqual({ findings: 7 });
  });

  it("uses bounded labels and measures observed work", async () => {
    const metrics = new TechnicalMetrics();
    metrics.observeHttp("GET", 200, 0.05);
    metrics.observeHttp("/secret-object", 503, 0.2);
    await expect(
      metrics.measure("parsing", () => Promise.reject(new Error("private"))),
    ).rejects.toThrow();
    const output = metrics.render().join("\n");
    expect(output).toContain(
      'inspector_stage_exceptions_total{stage="parsing"} 1',
    );
    expect(output).toContain('status_class="5xx"');
    expect(output).not.toMatch(/secret|private|object_id|user_id/);
    expect(metricsAuthorized(undefined, "Bearer token")).toBe(false);
    expect(metricsAuthorized("a".repeat(32), "Bearer " + "b".repeat(32))).toBe(
      false,
    );
    expect(metricsAuthorized("a".repeat(32), "Bearer " + "a".repeat(32))).toBe(
      true,
    );
  });

  it("notification port accepts actual producer names and excludes message contents", () => {
    const event = {
      id: randomUUID(),
      eventType: "protocol.generated",
      createdAt: new Date(),
      payload: {
        object_id: randomUUID(),
        protocol_id: randomUUID(),
        secret: "private",
      },
    };
    expect(notificationSignal(event)).toMatchObject({
      event_type: "protocol.generated",
      audience: "object-inspector",
    });
    expect(JSON.stringify(notificationSignal(event))).not.toContain("private");
    expect(
      notificationSignal({ ...event, eventType: "protocol.ready" }),
    ).toBeNull();
  });
});
