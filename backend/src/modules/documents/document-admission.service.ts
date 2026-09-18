import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "../../generated/prisma/client.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import {
  FileSafetyService,
  type FileFormat,
} from "../../infrastructure/storage/file-safety.service.js";
import { PrivateStorageService } from "../../infrastructure/storage/private-storage.service.js";
import {
  ObjectAccessService,
  type AuditContext,
} from "../objects/object-access.service.js";
import { canonicalJson } from "./canonical-json.js";
import type { FileOutcome, UploadResponse } from "./upload-contract.js";
import {
  FILE_LIMIT,
  type ReceivedFile,
  type ReceivedUpload,
} from "./upload-stream.js";

export function fingerprint(upload: ReceivedUpload) {
  const canonical = {
    object_id: upload.object_id,
    process_id: upload.process_id ?? null,
    files: [...upload.files]
      .sort((a, b) => a.client_file_id.localeCompare(b.client_file_id))
      .map(({ client_file_id, original_name, size, sha256 }) => ({
        client_file_id,
        original_name,
        size,
        sha256,
      })),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

interface Accepted {
  source: ReceivedFile;
  id: string;
  storageKey: string;
  format: FileFormat;
}

function duplicateOutcome(
  source: ReceivedFile,
  existing: { id: string; corruptedAt: Date | null },
): FileOutcome {
  return {
    client_file_id: source.client_file_id,
    original_name: source.original_name,
    accepted: false,
    error: "duplicate_file",
    existing_file_id: existing.id,
    message: existing.corruptedAt
      ? "Файл уже загружен, но целостность сохранённого оригинала нарушена. Требуется восстановление."
      : "Файл уже загружен в этот объект. Повторная копия не создана.",
  };
}

@Injectable()
export class DocumentAdmissionService {
  private readonly logger = new Logger(DocumentAdmissionService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ObjectAccessService,
    private readonly storage: PrivateStorageService,
    private readonly safety: FileSafetyService,
  ) {}

  private async existingContents(
    tx: Prisma.TransactionClient,
    upload: ReceivedUpload,
  ) {
    const contents = await tx.objectFileContent.findMany({
      where: {
        objectId: upload.object_id,
        sha256: { in: upload.files.map((file) => file.sha256) },
      },
      select: {
        sha256: true,
        file: { select: { id: true, corruptedAt: true } },
      },
    });
    return new Map(contents.map((content) => [content.sha256, content.file]));
  }

  private async replay(
    tx: Prisma.TransactionClient,
    userId: string,
    upload: ReceivedUpload,
    digest: string,
  ) {
    const receipt = await tx.uploadReceipt.findUnique({
      where: {
        userId_objectId_clientUploadId: {
          userId,
          objectId: upload.object_id,
          clientUploadId: upload.client_upload_id,
        },
      },
    });
    if (!receipt) return null;
    if (receipt.fingerprint !== digest)
      throw new ConflictException(
        "Ключ загрузки уже использован с другим содержимым",
      );
    return { httpStatus: receipt.httpStatus, response: receipt.response };
  }

  private async requireSession(
    tx: Prisma.TransactionClient,
    userId: string,
    sessionId: string,
  ) {
    const sessions = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM auth_sessions WHERE id = ${sessionId} AND user_id = ${userId} AND revoked_at IS NULL AND expires_at > now() FOR SHARE`;
    if (!sessions.length)
      throw new UnauthorizedException("Сессия недействительна");
  }

  async accept(
    context: AuditContext,
    upload: ReceivedUpload,
    deadline: number,
    sessionId: string,
  ) {
    const digest = fingerprint(upload);
    const original = await this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, upload.object_id);
      await this.access.requireAccess(tx, context.userId, upload.object_id);
      await this.requireSession(tx, context.userId, sessionId);
      const receipt = await this.replay(tx, context.userId, upload, digest);
      if (!receipt && upload.process_id) {
        const process = await tx.process.findUnique({
          where: { id: upload.process_id },
        });
        if (!process || process.objectId !== upload.object_id)
          throw new ConflictException(
            "Процесс не относится к выбранному объекту",
          );
        if (
          !["PENDING", "READY", "VERIFYING", "COMPLETED"].includes(
            process.status,
          )
        )
          throw new ConflictException(
            "Дозагрузка в текущем состоянии процесса запрещена",
          );
      }
      return { receipt, contents: await this.existingContents(tx, upload) };
    });
    if (original.receipt) return original.receipt;
    const accepted: Accepted[] = [];
    const published: string[] = [];
    const outcomes: FileOutcome[] = [];
    for (const source of upload.files) {
      if (Date.now() > deadline)
        throw new ConflictException(
          "Время приёма истекло. Повторите запрос с тем же ключом.",
        );
      const base = {
        client_file_id: source.client_file_id,
        original_name: source.original_name,
      };
      if (source.size > FILE_LIMIT) {
        outcomes.push({
          ...base,
          accepted: false,
          error: "file_too_large",
          message: "Файл превышает 50 МБ",
        });
        continue;
      }
      const existing = original.contents.get(source.sha256);
      if (existing) {
        outcomes.push(duplicateOutcome(source, existing));
        continue;
      }
      const result = await this.safety.inspect(source.key);
      if ("error" in result) {
        outcomes.push({ ...base, accepted: false, ...result });
        continue;
      }
      const id = randomUUID();
      const storageKey = await this.storage.publish(source.key);
      published.push(storageKey);
      if ((await this.storage.hash(storageKey)) !== source.sha256)
        throw new ConflictException(
          "Ошибка целостности при сохранении. Пакет не принят.",
        );
      accepted.push({ source, id, storageKey, format: result.format });
      original.contents.set(source.sha256, { id, corruptedAt: null });
      outcomes.push({
        ...base,
        accepted: true,
        file_id: id,
        sha256: source.sha256,
        size: source.size,
        format: result.format,
      });
    }

    const committedKeys = new Set<string>();
    const result = await this.prisma.$transaction(
      async (tx) => {
        await this.access.lock(tx, upload.object_id);
        await this.access.requireAccess(tx, context.userId, upload.object_id);
        await this.requireSession(tx, context.userId, sessionId);
        const previous = await this.replay(tx, context.userId, upload, digest);
        if (previous) return previous;
        if (Date.now() > deadline)
          throw new ConflictException("Время приёма истекло. Пакет не принят.");
        // Different upload keys can pass validation concurrently. Reconcile under
        // the object lock before creating a process or registering any new inputs.
        const existing = await this.existingContents(tx, upload);
        for (const [index, source] of upload.files.entries()) {
          const match = existing.get(source.sha256);
          if (
            match &&
            (outcomes[index]!.accepted ||
              outcomes[index]!.error === "duplicate_file")
          )
            outcomes[index] = duplicateOutcome(source, match);
        }
        const newFiles = accepted.filter(
          (item) => !existing.has(item.source.sha256),
        );
        let processId: string | null = null;
        let runId: string | null = null;
        let process = upload.process_id
          ? await tx.process.findUnique({ where: { id: upload.process_id } })
          : null;
        if (
          upload.process_id &&
          (!process || process.objectId !== upload.object_id)
        )
          throw new ConflictException(
            "Процесс не относится к выбранному объекту",
          );
        if (process) {
          // All process owners must lock this row before lifecycle mutations.
          await tx.$queryRaw`SELECT id FROM processes WHERE id = ${process.id}::uuid FOR UPDATE`;
          process = await tx.process.findUniqueOrThrow({
            where: { id: process.id },
          });
          if (
            !["PENDING", "READY", "VERIFYING", "COMPLETED"].includes(
              process.status,
            )
          )
            throw new ConflictException(
              "Дозагрузка в текущем состоянии процесса запрещена",
            );
        }
        if (newFiles.length) {
          process = process
            ? await tx.process.update({
                where: { id: process.id },
                data: { version: { increment: 1 }, status: "PENDING" },
              })
            : await tx.process.create({ data: { objectId: upload.object_id } });
          processId = process.id;
          runId = randomUUID();
          const existing = await tx.file.findMany({
            where: { processId },
            select: { id: true, sha256: true, corruptedAt: true },
          });
          if (existing.some((item) => item.corruptedAt !== null))
            throw new ConflictException(
              "В процессе обнаружен повреждённый оригинал; требуется восстановление источника",
            );
          const inputs = [
            ...existing.map((item) => ({
              file_id: item.id,
              file_hash: item.sha256,
            })),
            ...newFiles.map((item) => ({
              file_id: item.id,
              file_hash: item.source.sha256,
            })),
          ].sort((a, b) => a.file_id.localeCompare(b.file_id));
          const manifest = {
            schema_version: 1,
            object_id: upload.object_id,
            process_id: processId,
            run_id: runId,
            files: inputs,
            versions: {
              rules: null,
              model: null,
              dataset: null,
              expected_composition: null,
              decisions: null,
            },
          };
          const manifestHash = createHash("sha256")
            .update(canonicalJson(manifest))
            .digest("hex");
          await tx.run.create({
            data: {
              id: runId,
              processId,
              objectId: upload.object_id,
              version: process.version,
              inputManifest: manifest,
              inputManifestHash: manifestHash,
            },
          });
          for (const item of newFiles) {
            await tx.file.create({
              data: {
                id: item.id,
                objectId: upload.object_id,
                processId,
                runId,
                originalName: item.source.original_name,
                format: item.format,
                size: item.source.size,
                sha256: item.source.sha256,
                storageKey: item.storageKey,
                uploadedBy: context.userId,
              },
            });
            committedKeys.add(item.storageKey);
          }
          await tx.runInput.createMany({
            data: inputs.map((item) => ({
              fileId: item.file_id,
              runId: runId!,
              processId: processId!,
              objectId: upload.object_id,
            })),
          });
          const job = await tx.job.create({
            data: {
              runId,
              processId,
              objectId: upload.object_id,
              kind: "document.parsing",
            },
          });
          const eventId = randomUUID();
          await tx.outbox.create({
            data: {
              id: eventId,
              jobId: job.id,
              eventType: "documents.accepted",
              payload: {
                schema_version: 1,
                event_id: eventId,
                event_type: "documents.accepted",
                occurred_at: new Date().toISOString(),
                object_id: upload.object_id,
                process_id: processId,
                run_id: runId,
                job_id: job.id,
                input_manifest_hash: manifestHash,
                request_id: context.requestId,
              },
            },
          });
        }
        const response: UploadResponse = {
          schema_version: 1,
          object_id: upload.object_id,
          client_upload_id: upload.client_upload_id,
          process_id: processId,
          run_id: runId,
          files: outcomes,
        };
        const httpStatus = newFiles.length ? 202 : 422;
        const storedResponse = JSON.parse(
          JSON.stringify(response),
        ) as Prisma.InputJsonObject;
        await tx.uploadReceipt.create({
          data: {
            userId: context.userId,
            objectId: upload.object_id,
            clientUploadId: upload.client_upload_id,
            fingerprint: digest,
            processId,
            runId,
            httpStatus,
            response: storedResponse,
          },
        });
        await tx.auditEvent.create({
          data: {
            ...context,
            objectId: upload.object_id,
            action: "documents.admission",
            details: {
              schema_version: 1,
              process_id: processId,
              run_id: runId,
              accepted: newFiles.length,
              duplicates: outcomes.filter(
                (item) => item.error === "duplicate_file",
              ).length,
              rejected: outcomes.filter(
                (item) => !item.accepted && item.error !== "duplicate_file",
              ).length,
              client_upload_id: upload.client_upload_id,
            },
          },
        });
        const reasons = outcomes.flatMap((item) =>
          item.error && item.error !== "duplicate_file" ? [item.error] : [],
        );
        if (reasons.length) {
          const eventId = randomUUID();
          await tx.outbox.create({
            data: {
              id: eventId,
              eventType: "documents.admission.rejected",
              payload: {
                schema_version: 1,
                event_id: eventId,
                event_type: "documents.admission.rejected",
                occurred_at: new Date().toISOString(),
                object_id: upload.object_id,
                process_id: processId,
                run_id: runId,
                request_id: context.requestId,
                user_id: context.userId,
                reasons,
                rejected_count: reasons.length,
              },
            },
          });
        }
        return { httpStatus, response: storedResponse };
      },
      { timeout: 15_000 },
    );
    // Commit succeeded: these private handles lost a race (or replayed a receipt).
    // Never remove anything after an uncertain commit; the stale-orphan collector handles it.
    for (const key of published) {
      if (!committedKeys.has(key)) {
        try {
          await this.storage.discardUncommittedOriginal(key);
        } catch {
          this.logger.warn("Uncommitted original awaits orphan cleanup");
        }
      }
    }
    return result;
  }
}
