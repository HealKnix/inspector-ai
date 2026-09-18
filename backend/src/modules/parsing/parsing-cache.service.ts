import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient } from "redis";
import { UUID } from "./parsing-contract.js";

@Injectable()
export class ParsingCacheService implements OnApplicationShutdown {
  private client: ReturnType<typeof createClient> | undefined;
  private connecting: Promise<void> | undefined;
  private retryAt = 0;
  constructor(private readonly config: ConfigService) {}
  private async ready() {
    const url = this.config.get<string>("REDIS_URL");
    if (!url || Date.now() < this.retryAt) return null;
    if (!this.client) {
      this.client = createClient({
        url,
        disableOfflineQueue: true,
        commandsQueueMaxLength: 10,
        socket: { connectTimeout: 1500, reconnectStrategy: false },
      });
      this.client.on("error", () => {
        this.retryAt = Date.now() + 30_000;
      });
    }
    if (!this.client.isReady && !this.connecting)
      this.connecting = this.client
        .connect()
        .then(() => undefined)
        .catch(() => {
          this.retryAt = Date.now() + 30_000;
        })
        .finally(() => {
          this.connecting = undefined;
        });
    await this.connecting;
    return this.client.isReady ? this.client : null;
  }
  async get(hash: string, fingerprint: string) {
    try {
      const client = await this.ready();
      const id = await client
        ?.withCommandOptions({ timeout: 1500 })
        .get(`par:v1:${hash}:${fingerprint}`);
      return typeof id === "string" && UUID.test(id) ? id : null;
    } catch {
      return null;
    }
  }
  async put(hash: string, fingerprint: string, artifactId: string) {
    try {
      const client = await this.ready();
      await client
        ?.withCommandOptions({ timeout: 1500 })
        .set(`par:v1:${hash}:${fingerprint}`, artifactId, { EX: 86400 * 30 });
    } catch {
      /* Durable artifact remains available without Redis. */
    }
  }
  onApplicationShutdown() {
    if (this.client?.isOpen) this.client.destroy();
  }
}
