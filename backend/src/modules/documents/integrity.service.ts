import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { PrivateStorageService } from "../../infrastructure/storage/private-storage.service.js";

@Injectable()
export class IntegrityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: PrivateStorageService,
  ) {}

  async checkOne() {
    const file = await this.prisma.file.findFirst({
      where: {
        OR: [
          { integrityCheckedAt: null },
          { integrityCheckedAt: { lt: new Date(Date.now() - 86_400_000) } },
        ],
      },
      orderBy: [
        { integrityCheckedAt: { sort: "asc", nulls: "first" } },
        { id: "asc" },
      ],
    });
    if (!file) return false;
    let valid = false;
    try {
      valid = (await this.storage.hash(file.storageKey)) === file.sha256;
    } catch {
      valid = false;
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${file.objectId}, 0))`;
      await tx.file.update({
        where: { id: file.id },
        data: { integrityCheckedAt: new Date() },
      });
      if (!valid) {
        const changed = await tx.file.updateMany({
          where: { id: file.id, corruptedAt: null },
          data: { corruptedAt: new Date() },
        });
        if (changed.count) {
          const eventId = randomUUID();
          await tx.outbox.create({
            data: {
              id: eventId,
              eventType: "file.integrity-failed",
              payload: {
                schema_version: 1,
                event_id: eventId,
                event_type: "file.integrity-failed",
                occurred_at: new Date().toISOString(),
                object_id: file.objectId,
                process_id: file.processId,
                run_id: file.runId,
                file_id: file.id,
                expected_sha256: file.sha256,
                request_id: randomUUID(),
              },
            },
          });
        }
      }
    });
    return true;
  }

  async cleanup() {
    await this.storage.cleanup("quarantine", () => Promise.resolve(false));
    await this.storage.cleanup(
      "originals",
      async (storageKey) =>
        (await this.prisma.file.count({ where: { storageKey } })) !== 0,
    );
  }
}
