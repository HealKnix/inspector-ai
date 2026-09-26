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
import { PrismaModule } from "./infrastructure/prisma/prisma.module.js";
import { OutboxService } from "./infrastructure/rabbitmq/outbox.service.js";
import {
  CLASSIFICATION_QUEUE,
  ClassificationJobsService,
} from "./modules/identification/classification-jobs.service.js";
import { ClassificationCoreModule } from "./modules/identification/classification.module.js";
import { IdentificationJobsService } from "./modules/identification/identification-jobs.service.js";
import { IdentificationCoreModule } from "./modules/identification/identification.module.js";
import { UUID } from "./modules/parsing/parsing-contract.js";
import { ParsingDeliveryScope } from "./modules/parsing/parsing-delivery-scope.js";

const DEAD_QUEUE = "inspector.classification.dead";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    PrismaModule,
    ClassificationCoreModule,
    IdentificationCoreModule,
  ],
  providers: [OutboxService],
})
class ClassificationWorkerModule {}

function readTaskId(
  content: Buffer,
): { id: string; identification: boolean } | null {
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
    !["classification.requested", "identification.requested"].includes(
      String(payload.event_type),
    ) ||
    !("task_id" in payload) ||
    typeof payload.task_id !== "string" ||
    !UUID.test(payload.task_id)
  )
    return null;
  return {
    id: payload.task_id,
    identification: payload.event_type === "identification.requested",
  };
}

async function main() {
  const app = await NestFactory.createApplicationContext(
    ClassificationWorkerModule,
  );
  const config = app.get(ConfigService);
  const logger = new Logger("ClassificationWorker");
  const jobs = app.get(ClassificationJobsService);
  const identification = app.get(IdentificationJobsService);
  const outbox = app.get(OutboxService);
  const stopping = new AbortController();
  let connected = false;
  let lastTick = Date.now();
  const server = createServer((_request, response) => {
    response.writeHead(
      connected && Date.now() - lastTick < 120_000 ? 200 : 503,
    );
    response.end();
  }).listen(
    Number(process.env.CLASSIFICATION_WORKER_HEALTH_PORT ?? 3003),
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
      const taskId = readTaskId(message.content);
      if (taskId === null) {
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
      } else {
        if (taskId.identification)
          await identification.execute(taskId.id, signal);
        else await jobs.execute(taskId.id, signal);
      }
      owner.ack(message);
    } catch {
      // Durable job attempts bound recovery; closing requeues the unacknowledged delivery.
      await owner.close().catch(() => undefined);
      if (channel === owner) connected = false;
      logger.warn(
        JSON.stringify({ event: "classification.delivery.interrupted" }),
      );
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
          for (const queue of [CLASSIFICATION_QUEUE, DEAD_QUEUE])
            await channel.assertQueue(queue, { durable: true });
          await channel.prefetch(1);
          await channel.consume(
            CLASSIFICATION_QUEUE,
            (message) => {
              void currentScope
                .run((signal) => consume(message, ownerChannel, signal))
                .catch(channelClosed);
            },
            { noAck: false },
          );
          connected = !currentScope.signal.aborted;
        }
        if (Date.now() >= recoverAt) {
          await jobs.recover();
          await identification.recover();
          recoverAt = Date.now() + 5000;
        }
        await outbox.dispatchOne();
        lastTick = Date.now();
      } catch {
        logger.warn(
          JSON.stringify({ event: "classification.worker.tick.failed" }),
        );
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
  new Logger("ClassificationWorker").error(
    JSON.stringify({ event: "classification.worker.start.failed" }),
  );
  process.exitCode = 1;
});
