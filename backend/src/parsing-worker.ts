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
  ParsingError,
  UUID,
  validateMessage,
} from "./modules/parsing/parsing-contract.js";
import { ParsingDeliveryScope } from "./modules/parsing/parsing-delivery-scope.js";
import {
  FILE_QUEUE,
  PARENT_QUEUE,
  ParsingJobsService,
} from "./modules/parsing/parsing-jobs.service.js";
import { ParsingCoreModule } from "./modules/parsing/parsing.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    PrismaModule,
    ParsingCoreModule,
  ],
  providers: [OutboxService],
})
class ParsingWorkerModule {}

async function main() {
  const app = await NestFactory.createApplicationContext(ParsingWorkerModule);
  const config = app.get(ConfigService);
  if ((config.get<string>("PARSER_TOKEN") ?? "").length < 32)
    throw new Error("PARSER_TOKEN must contain at least 32 characters");
  const logger = new Logger("ParsingWorker");
  const jobs = app.get(ParsingJobsService);
  const outbox = app.get(OutboxService);
  const stopping = new AbortController();
  let connected = false;
  let lastTick = Date.now();
  const server = createServer((_request, response) => {
    response.writeHead(
      connected && Date.now() - lastTick < 120_000 ? 200 : 503,
    );
    response.end();
  }).listen(Number(process.env.PARSING_WORKER_HEALTH_PORT ?? 3002), "0.0.0.0");
  process.once("SIGTERM", () => stopping.abort());
  process.once("SIGINT", () => stopping.abort());
  let connection: ChannelModel | undefined;
  let channel: ConfirmChannel | undefined;
  let scope: ParsingDeliveryScope | undefined;
  async function consume(
    message: ConsumeMessage | null,
    parent: boolean,
    owner: ConfirmChannel,
    signal: AbortSignal,
  ) {
    if (!message || signal.aborted) return;
    try {
      if (message.content.length > 16_384)
        throw new ParsingError("invalid_queue_message", false);
      let payload: unknown;
      try {
        payload = JSON.parse(message.content.toString("utf8")) as unknown;
      } catch {
        throw new ParsingError("invalid_queue_message", false);
      }
      if (parent) await jobs.fanout(payload);
      else await jobs.execute(validateMessage(payload), signal);
      owner.ack(message);
    } catch (error) {
      if (error instanceof ParsingError && !error.retryable) {
        // The quarantine envelope excludes raw payloads, which may contain content.
        await new Promise<void>((resolve, reject) =>
          owner.sendToQueue(
            "inspector.parsing.dead",
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
        owner.ack(message);
      } else {
        // Closing the channel requeues unacknowledged deliveries. Recovery is
        // bounded by the durable task attempts and the connection backoff.
        await owner.close().catch(() => undefined);
        if (channel === owner) connected = false;
        logger.warn(JSON.stringify({ event: "parsing.delivery.interrupted" }));
      }
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
          const schedule = (
            message: ConsumeMessage | null,
            parent: boolean,
          ) => {
            void currentScope
              .run((signal) => consume(message, parent, ownerChannel, signal))
              .catch(channelClosed);
          };
          for (const queue of [
            PARENT_QUEUE,
            FILE_QUEUE,
            "inspector.parsing.dead",
          ])
            await channel.assertQueue(queue, { durable: true });
          await channel.prefetch(1);
          await channel.consume(
            PARENT_QUEUE,
            (message) => schedule(message, true),
            { noAck: false },
          );
          await channel.consume(
            FILE_QUEUE,
            (message) => schedule(message, false),
            { noAck: false },
          );
          connected = !currentScope.signal.aborted;
        }
        if (Date.now() >= recoverAt) {
          await jobs.recover();
          recoverAt = Date.now() + 5000;
        }
        await outbox.dispatchOne();
        lastTick = Date.now();
      } catch {
        logger.warn(JSON.stringify({ event: "parsing.worker.tick.failed" }));
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
  new Logger("ParsingWorker").error(
    JSON.stringify({ event: "parsing.worker.start.failed" }),
  );
  process.exitCode = 1;
});
