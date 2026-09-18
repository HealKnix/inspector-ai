import { Logger, Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { createServer } from "node:http";
import { setTimeout } from "node:timers/promises";
import "reflect-metadata";
import { validateEnvironment } from "./config/environment.js";
import { PrismaModule } from "./infrastructure/prisma/prisma.module.js";
import { OutboxService } from "./infrastructure/rabbitmq/outbox.service.js";
import { PrivateStorageService } from "./infrastructure/storage/private-storage.service.js";
import { IntegrityService } from "./modules/documents/integrity.service.js";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    PrismaModule,
  ],
  providers: [OutboxService, PrivateStorageService, IntegrityService],
})
class WorkerModule {}

async function main() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  const logger = new Logger("IngestionWorker");
  const outbox = app.get(OutboxService);
  const integrity = app.get(IntegrityService);
  let stopping = false;
  let lastTick = Date.now();
  let cleanupAt = 0;
  const server = createServer((_request, response) => {
    response.writeHead(Date.now() - lastTick < 120_000 ? 200 : 503);
    response.end();
  }).listen(Number(process.env.WORKER_HEALTH_PORT ?? 3001), "0.0.0.0");
  const stop = () => {
    stopping = true;
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    while (!stopping) {
      try {
        await outbox.dispatchOne();
        await integrity.checkOne();
        if (Date.now() > cleanupAt) {
          await integrity.cleanup();
          cleanupAt = Date.now() + 3_600_000;
        }
        lastTick = Date.now();
      } catch {
        logger.error(JSON.stringify({ event: "worker.iteration.failed" }));
      }
      await setTimeout(1000);
    }
  } finally {
    server.close();
    await app.close();
  }
}
void main();
