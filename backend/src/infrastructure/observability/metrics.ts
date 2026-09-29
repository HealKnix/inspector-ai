import { connect } from "amqplib";
import { timingSafeEqual } from "node:crypto";
import { statfs } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { PrismaService } from "../prisma/prisma.service.js";

export const STAGES = [
  "outbox",
  "parsing",
  "classification",
  "identification",
  "extraction",
  "parser",
] as const;
export type Stage = (typeof STAGES)[number];
const buckets = [0.01, 0.05, 0.1, 0.5, 1, 5, 30, 120, 600];
interface Histogram {
  count: number;
  sum: number;
  buckets: number[];
}
function empty(): Histogram {
  return { count: 0, sum: 0, buckets: buckets.map(() => 0) };
}
function observe(target: Histogram, seconds: number) {
  target.count++;
  target.sum += seconds;
  buckets.forEach((bound, i) => {
    if (seconds <= bound) target.buckets[i] = (target.buckets[i] ?? 0) + 1;
  });
}

export class TechnicalMetrics {
  private readonly http = new Map<string, Histogram>();
  private readonly stages = new Map<Stage, Histogram>();
  private readonly failures = new Map<Stage, number>();
  observeHttp(method: string, status: number, seconds: number) {
    const verb = [
      "GET",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "HEAD",
      "OPTIONS",
    ].includes(method)
      ? method
      : "OTHER";
    const statusClass =
      status >= 100 && status < 600 ? Math.floor(status / 100) + "xx" : "other";
    const key = `method="${verb}",status_class="${statusClass}"`;
    const value = this.http.get(key) ?? empty();
    observe(value, seconds);
    this.http.set(key, value);
  }
  async measure<T>(stage: Stage, operation: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await operation();
    } catch (error) {
      this.failures.set(stage, (this.failures.get(stage) ?? 0) + 1);
      throw error;
    } finally {
      const value = this.stages.get(stage) ?? empty();
      observe(value, (performance.now() - start) / 1000);
      this.stages.set(stage, value);
    }
  }
  render() {
    const output: string[] = [];
    const histogram = (name: string, labels: string, value: Histogram) => {
      output.push(
        `${name}_count{${labels}} ${value.count}`,
        `${name}_sum{${labels}} ${value.sum}`,
      );
      buckets.forEach((bound, i) =>
        output.push(
          `${name}_bucket{${labels},le="${bound}"} ${value.buckets[i]}`,
        ),
      );
      output.push(`${name}_bucket{${labels},le="+Inf"} ${value.count}`);
    };
    output.push("# TYPE inspector_http_request_duration_seconds histogram");
    for (const [labels, value] of this.http)
      histogram("inspector_http_request_duration_seconds", labels, value);
    output.push("# TYPE inspector_stage_duration_seconds histogram");
    for (const [stage, value] of this.stages)
      histogram("inspector_stage_duration_seconds", `stage="${stage}"`, value);
    for (const stage of STAGES)
      output.push(
        `inspector_stage_exceptions_total{stage="${stage}"} ${this.failures.get(stage) ?? 0}`,
      );
    const cpu = process.cpuUsage(),
      memory = process.memoryUsage();
    output.push(
      `process_cpu_user_seconds_total ${cpu.user / 1_000_000}`,
      `process_cpu_system_seconds_total ${cpu.system / 1_000_000}`,
      `process_resident_memory_bytes ${memory.rss}`,
      `nodejs_heap_size_used_bytes ${memory.heapUsed}`,
      `process_uptime_seconds ${process.uptime()}`,
    );
    return output;
  }
}
export const technicalMetrics = new TechnicalMetrics();

export function metricsAuthorized(
  token: string | undefined,
  authorization: string | undefined,
) {
  if (
    !token ||
    token.length < 32 ||
    !authorization ||
    authorization.length > 512
  )
    return false;
  const expected = Buffer.from(`Bearer ${token}`),
    actual = Buffer.from(authorization);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function renderMetrics(
  prisma: PrismaService,
  storageRoot: string,
  rabbitUrl?: string,
) {
  const lines = technicalMetrics.render();
  try {
    const disk = await statfs(storageRoot);
    lines.push(
      'inspector_metrics_source_up{source="storage"} 1',
      `inspector_storage_available_bytes ${disk.bavail * disk.bsize}`,
      `inspector_storage_size_bytes ${disk.blocks * disk.bsize}`,
    );
  } catch {
    lines.push('inspector_metrics_source_up{source="storage"} 0');
  }
  try {
    const [sessions, pending, exhausted] = await Promise.all([
      prisma.authSession.count({
        where: { revokedAt: null, expiresAt: { gt: new Date() } },
      }),
      prisma.outbox.count({ where: { deliveredAt: null } }),
      prisma.outbox.count({
        where: { deliveredAt: null, attempts: { gte: 20 } },
      }),
    ]);
    lines.push(
      'inspector_metrics_source_up{source="database"} 1',
      `inspector_active_sessions ${sessions}`,
      `inspector_outbox_pending ${pending}`,
      `inspector_outbox_exhausted ${exhausted}`,
    );
  } catch {
    lines.push('inspector_metrics_source_up{source="database"} 0');
  }
  if (rabbitUrl) {
    try {
      const connection = await connect(rabbitUrl, { timeout: 2000 });
      connection.on("error", () => undefined);
      try {
        for (const queue of [
          "inspector.documents.accepted",
          "inspector.parsing.files",
          "inspector.classification.files",
          "inspector.extraction.artifacts",
          "inspector.events",
        ]) {
          const channel = await connection.createChannel();
          channel.on("error", () => undefined);
          try {
            const snapshot = await channel.checkQueue(queue);
            lines.push(
              `inspector_queue_source_up{queue="${queue}"} 1`,
              `inspector_queue_ready_messages{queue="${queue}"} ${snapshot.messageCount}`,
              `inspector_queue_consumers{queue="${queue}"} ${snapshot.consumerCount}`,
            );
          } catch {
            lines.push(`inspector_queue_source_up{queue="${queue}"} 0`);
          } finally {
            await channel.close().catch(() => undefined);
          }
        }
        lines.push('inspector_metrics_source_up{source="rabbitmq"} 1');
      } finally {
        await connection.close();
      }
    } catch {
      lines.push('inspector_metrics_source_up{source="rabbitmq"} 0');
    }
  } else lines.push('inspector_metrics_source_up{source="rabbitmq"} 0');
  return lines.join("\n") + "\n";
}

export async function serveWorkerMetrics(
  request: IncomingMessage,
  response: ServerResponse,
  prisma: PrismaService,
) {
  if (request.url !== "/metrics") return false;
  if (!process.env.METRICS_TOKEN) {
    response.writeHead(404).end();
    return true;
  }
  if (
    !metricsAuthorized(process.env.METRICS_TOKEN, request.headers.authorization)
  ) {
    response.writeHead(401).end();
    return true;
  }
  response.writeHead(200, {
    "Content-Type": "text/plain; version=0.0.4",
    "Cache-Control": "no-store",
  });
  response.end(
    await renderMetrics(
      prisma,
      process.env.STORAGE_ROOT ?? "./var/documents",
      process.env.RABBITMQ_URL,
    ),
  );
  return true;
}
