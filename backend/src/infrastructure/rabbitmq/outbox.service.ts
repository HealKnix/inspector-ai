import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { connect } from "amqplib";
import { randomUUID } from "node:crypto";
import type { Outbox } from "../../generated/prisma/client.js";
import { technicalMetrics } from "../observability/metrics.js";
import {
  businessPayload,
  storedTrace,
  traceContext,
} from "../observability/trace-context.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async dispatchOne() {
    const token = randomUUID();
    const [event] = await this.prisma.$queryRaw<Outbox[]>`
      UPDATE outbox SET lease_token = ${token}::uuid, lease_until = now() + interval '60 seconds'
      WHERE id = (SELECT id FROM outbox WHERE delivered_at IS NULL AND attempts < 20 AND available_at <= now()
        AND (lease_until IS NULL OR lease_until < now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING id, job_id AS "jobId", event_type AS "eventType", payload, attempts`;
    if (!event) return false;
    return traceContext.run(storedTrace(event.payload, event.id), () =>
      technicalMetrics.measure("outbox", async () => {
        try {
          const connection = await connect(
            this.config.getOrThrow<string>("RABBITMQ_URL"),
            { timeout: 10_000 },
          );
          connection.on("error", () =>
            this.logger.warn(
              JSON.stringify({
                event: "broker.connection.failed",
                event_id: event.id,
              }),
            ),
          );
          try {
            const channel = await connection.createConfirmChannel();
            channel.on("error", () =>
              this.logger.warn(
                JSON.stringify({
                  event: "broker.channel.failed",
                  event_id: event.id,
                }),
              ),
            );
            const queue =
              event.eventType === "documents.accepted"
                ? "inspector.documents.accepted"
                : event.eventType === "parsing.requested"
                  ? "inspector.parsing.files"
                  : [
                        "classification.requested",
                        "identification.requested",
                      ].includes(event.eventType)
                    ? "inspector.classification.files"
                    : [
                          "extraction.requested",
                          "section_analysis.requested",
                        ].includes(event.eventType)
                      ? "inspector.extraction.artifacts"
                      : "inspector.events";
            await channel.assertQueue(queue, { durable: true });
            let returned = false;
            channel.on("return", () => {
              returned = true;
            });
            await new Promise<void>((resolve, reject) => {
              const timer = setTimeout(
                () => reject(new Error("Confirm timeout")),
                10_000,
              );
              channel.sendToQueue(
                queue,
                Buffer.from(JSON.stringify(businessPayload(event.payload))),
                {
                  persistent: true,
                  mandatory: true,
                  messageId: event.id,
                  type: event.eventType,
                  contentType: "application/json",
                  correlationId: traceContext.getStore()?.correlation_id,
                  headers: {
                    "x-request-id": traceContext.getStore()?.request_id,
                    "x-correlation-id": traceContext.getStore()?.correlation_id,
                  },
                },
                (error: unknown) => {
                  clearTimeout(timer);
                  if (error || returned)
                    reject(new Error("Publication not confirmed"));
                  else resolve();
                },
              );
            });
            await this.prisma.outbox.updateMany({
              where: { id: event.id, leaseToken: token },
              data: {
                deliveredAt: new Date(),
                leaseUntil: null,
                leaseToken: null,
                lastError: null,
              },
            });
            this.logger.log({
              event: "outbox.delivery.confirmed",
              event_id: event.id,
            });
          } finally {
            await connection.close();
          }
        } catch {
          await this.prisma.outbox.updateMany({
            where: { id: event.id, leaseToken: token, deliveredAt: null },
            data: {
              attempts: { increment: 1 },
              leaseUntil: null,
              leaseToken: null,
              availableAt: new Date(
                Date.now() + Math.min(300_000, 1000 * 2 ** event.attempts),
              ),
              lastError: "broker_delivery_failed",
            },
          });
          this.logger.warn(
            JSON.stringify({
              event: "outbox.delivery.failed",
              event_id: event.id,
              attempt: event.attempts + 1,
              exhausted: event.attempts + 1 >= 20,
            }),
          );
        }
        return true;
      }),
    );
  }
}
