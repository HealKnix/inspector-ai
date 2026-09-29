import { Logger, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import {
  connect,
  type ChannelModel,
  type ConfirmChannel,
  type ConsumeMessage,
} from "amqplib";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import "reflect-metadata";
import { validateEnvironment } from "./config/environment.js";
import { observeDelivery } from "./infrastructure/observability/delivery-observation.js";
import { serveWorkerMetrics } from "./infrastructure/observability/metrics.js";
import { StructuredLogger } from "./infrastructure/observability/structured-logger.js";
import { PrismaModule } from "./infrastructure/prisma/prisma.module.js";
import { PrismaService } from "./infrastructure/prisma/prisma.service.js";
import { OutboxService } from "./infrastructure/rabbitmq/outbox.service.js";
import {
  EXTRACTION_QUEUE,
  ExtractionJobsService,
} from "./modules/extraction/extraction-jobs.service.js";
import { ExtractionCoreModule } from "./modules/extraction/extraction.module.js";
import { SectionAnalysisJobsService } from "./modules/extraction/section-analysis-jobs.service.js";
import { UUID } from "./modules/parsing/parsing-contract.js";
import { ParsingDeliveryScope } from "./modules/parsing/parsing-delivery-scope.js";

const DEAD_QUEUE = "inspector.extraction.dead";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    PrismaModule,
    ExtractionCoreModule,
  ],
  providers: [OutboxService],
})
class ExtractionWorkerModule {}

const TASK_EVENTS = {
  "extraction.requested": "extraction",
  "section_analysis.requested": "section_analysis",
} as const;

function readTask(content: Buffer): {
  kind: (typeof TASK_EVENTS)[keyof typeof TASK_EVENTS];
  taskId: string;
} | null {
  if (content.length > 16_384) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(content.toString("utf8")) as unknown;
  } catch {
    return null;
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload) ||
    Object.keys(payload).length !== 3 ||
    !("schema_version" in payload) ||
    payload.schema_version !== 1 ||
    !("event_type" in payload) ||
    typeof payload.event_type !== "string" ||
    !Object.hasOwn(TASK_EVENTS, payload.event_type) ||
    !("task_id" in payload) ||
    typeof payload.task_id !== "string" ||
    !UUID.test(payload.task_id)
  )
    return null;
  return {
    kind: TASK_EVENTS[payload.event_type as keyof typeof TASK_EVENTS],
    taskId: payload.task_id,
  };
}

async function main() {
  Logger.overrideLogger(new StructuredLogger("extraction-worker"));
  const app = await NestFactory.createApplicationContext(
    ExtractionWorkerModule,
  );
  const config = app.get(ConfigService);
  const logger = new Logger("ExtractionWorker");
  const jobs = app.get(ExtractionJobsService);
  const sectionJobs = app.get(SectionAnalysisJobsService);
  const outbox = app.get(OutboxService);
  const stopping = new AbortController();
  let connected = false;
  let lastTick = Date.now();
  const server = createServer((request, response) => {
    void serveWorkerMetrics(request, response, app.get(PrismaService))
      .then((handled) => {
        if (handled) return;
        response.writeHead(
          connected && Date.now() - lastTick < 120_000 ? 200 : 503,
        );
        response.end();
      })
      .catch(() => response.writeHead(503).end());
  }).listen(
    Number(process.env.EXTRACTION_WORKER_HEALTH_PORT ?? 3004),
    "0.0.0.0",
  );
  process.once("SIGTERM", () => stopping.abort());
  process.once("SIGINT", () => stopping.abort());
  let connection: ChannelModel | undefined;
  let channel: ConfirmChannel | undefined;
  let scope: ParsingDeliveryScope | undefined;

  async function consume(
    message: ConsumeMessage | null,
    owner: ConfirmChannel,
    signal: AbortSignal,
  ) {
    if (!message || signal.aborted) return;
    try {
      const task = readTask(message.content);
      if (task === null) {
        // Quarantine metadata only: never copy untrusted payloads into a dead queue.
        await new Promise<void>((resolve, reject) =>
          owner.sendToQueue(
            DEAD_QUEUE,
            Buffer.from(
              JSON.stringify({
                schema_version: 1,
                code: "invalid_queue_message",
                message_id:
                  typeof message.properties.messageId === "string" &&
                  UUID.test(message.properties.messageId)
                    ? message.properties.messageId
                    : null,
              }),
            ),
            { persistent: true },
            (failure: unknown) =>
              failure
                ? reject(new Error("Dead letter publication failed"))
                : resolve(),
          ),
        );
      } else if (task.kind === "section_analysis") {
        await sectionJobs.execute(task.taskId, signal);
      } else {
        await jobs.execute(task.taskId, signal);
      }
      owner.ack(message);
    } catch {
      // Durable job attempts bound recovery; closing requeues the unacknowledged delivery.
      await owner.close().catch(() => undefined);
      if (channel === owner) connected = false;
      logger.warn(JSON.stringify({ event: "extraction.delivery.interrupted" }));
    }
  }

  try {
    let recoverAt = 0;
    while (!stopping.signal.aborted) {
      try {
        if (!connected) {
          scope?.cancel();
          await channel?.close().catch(() => undefined);
          await connection?.close().catch(() => undefined);
          await scope?.drain();
          if (stopping.signal.aborted) break;
          const currentScope = new ParsingDeliveryScope(stopping.signal);
          scope = currentScope;
          connection = await connect(
            config.getOrThrow<string>("RABBITMQ_URL"),
            { timeout: 10_000 },
          );
          const ownerConnection = connection;
          const disconnect = () => {
            currentScope.cancel();
            if (connection === ownerConnection) connected = false;
          };
          connection.on("error", disconnect);
          connection.on("close", disconnect);
          channel = await connection.createConfirmChannel();
          const ownerChannel = channel;
          const channelClosed = () => {
            currentScope.cancel();
            if (channel === ownerChannel) connected = false;
          };
          channel.on("error", channelClosed);
          channel.on("close", channelClosed);
          for (const queue of [EXTRACTION_QUEUE, DEAD_QUEUE])
            await channel.assertQueue(queue, { durable: true });
          await channel.prefetch(1);
          await channel.consume(
            EXTRACTION_QUEUE,
            (message) => {
              void currentScope
                .run((signal) =>
                  observeDelivery(
                    message?.properties.headers,
                    message?.properties.messageId,
                    "extraction",
                    () => consume(message, ownerChannel, signal),
                  ),
                )
                .catch(channelClosed);
            },
            { noAck: false },
          );
          connected = !currentScope.signal.aborted;
        }
        if (Date.now() >= recoverAt) {
          await jobs.recover();
          await sectionJobs.recover();
          recoverAt = Date.now() + 5000;
        }
        await outbox.dispatchOne();
        lastTick = Date.now();
      } catch {
        logger.warn(JSON.stringify({ event: "extraction.worker.tick.failed" }));
        await delay(5000, undefined, { signal: stopping.signal }).catch(
          () => undefined,
        );
      }
      await delay(1000, undefined, { signal: stopping.signal }).catch(
        () => undefined,
      );
    }
  } finally {
    scope?.cancel();
    await channel?.close().catch(() => undefined);
    await scope?.drain();
    await connection?.close().catch(() => undefined);
    server.close();
    await app.close();
  }
}

void main().catch(() => {
  new Logger("ExtractionWorker").error(
    JSON.stringify({ event: "extraction.worker.start.failed" }),
  );
  process.exitCode = 1;
});
