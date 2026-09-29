import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Prisma } from "../../generated/prisma/client.js";
import { writeAuditEvent } from "../../infrastructure/audit/audit-envelope.js";
import { writeOutboxEvent } from "../../infrastructure/observability/trace-context.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { CompletenessService } from "../completeness/completeness.service.js";
import { pinRunRelease } from "../extraction/rule-set-release.js";
import {
  ObjectAccessService,
  type AuditContext,
} from "../objects/object-access.service.js";
import { ArtifactStorageService } from "../parsing/artifact-storage.service.js";
import { ParserClientService } from "../parsing/parser-client.service.js";
import type { ClassificationStage } from "./classification-contract.js";
import {
  IDENTIFICATION_ENGINE_VERSION,
  IdentificationContractError,
  validateClarificationBatch,
  type ClarificationBatch,
  type IdentificationDocument,
  type IdentificationRevision,
  type IdentificationSnapshot,
  type IdentifiedRevision,
  type RevisionClarification,
} from "./identification-contract.js";
import {
  buildSelectionSnapshot,
  normalizeIdentificationText,
} from "./identification-engine.js";
import {
  groupResolvedDocuments,
  type DocumentAlias,
} from "./identification-grouping.js";
import {
  IDENTIFICATION_POLICY_VERSIONS,
  identificationBusy,
  identificationHash,
  identificationJson,
  identificationSources,
  type IdentificationSources,
} from "./identification-state.js";
import {
  predecessorId,
  resolveSheetSet,
  validateRevisionSheetMap,
} from "./sheet-selection.js";

const EDITABLE = ["PENDING", "READY", "VERIFYING", "COMPLETED"];
interface StoredIdentificationSnapshot extends IdentificationSnapshot {
  document_aliases: DocumentAlias[];
  decision_ids: string[];
}

function partFingerprint(artifactId: string, classificationId: string | null) {
  return identificationHash({
    engine: IDENTIFICATION_ENGINE_VERSION,
    artifact: artifactId,
    classification: classificationId,
  });
}

function cacheIdentity(input: IdentificationSources["sources"][number]) {
  const artifact = input.artifact;
  return artifact
    ? identificationHash({
        artifact_id: artifact.id,
        storage_key: artifact.storageKey,
        artifact_sha256: artifact.artifactSha256,
        source_sha256: input.file.sha256,
        pipeline_fingerprint: artifact.pipelineFingerprint,
      })
    : null;
}

function conflict(code: string, message: string): never {
  throw new ConflictException({ code, message });
}

function applyPatch(
  revision: IdentificationRevision,
  patch: RevisionClarification,
) {
  for (const [field, value] of Object.entries(patch.fields ?? {})) {
    if (value === null)
      delete (revision.fields as Record<string, string>)[field];
    else {
      (revision.fields as Record<string, string>)[field] = value;
      // Only an explicit inspector value resolves that field's conflicting
      // observations. Mixed/partial source limitations remain in force.
      revision.blockers = revision.blockers.filter(
        (reason) => reason !== `field_conflict:${field}`,
      );
    }
  }
  if (patch.approval !== undefined)
    revision.approval = structuredClone(patch.approval);
  if (patch.reference_revision_id !== undefined)
    revision.reference_revision_id = patch.reference_revision_id;
  if (patch.sheet_map !== undefined)
    revision.sheet_map = structuredClone(patch.sheet_map);
  if (patch.sheet_replacement !== undefined)
    revision.sheet_replacement = structuredClone(patch.sheet_replacement);
}

@Injectable()
export class IdentificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ObjectAccessService,
    private readonly parser: ParserClientService,
    private readonly completeness: CompletenessService,
    private readonly artifacts: ArtifactStorageService,
  ) {}

  static readSnapshot(tx: Prisma.TransactionClient, runId: string) {
    return tx.resolvedInputSnapshot.findFirst({
      where: { runId },
      orderBy: { version: "desc" },
    });
  }

  private async permittedProcess(
    tx: Prisma.TransactionClient,
    userId: string,
    processId: string,
  ) {
    const initial = await tx.process.findUnique({ where: { id: processId } });
    if (!initial) throw new NotFoundException("Процесс недоступен");
    await this.access.lock(tx, initial.objectId);
    await this.access.requireAccess(tx, userId, initial.objectId);
    await tx.$queryRaw`SELECT id FROM processes WHERE id=${processId}::uuid FOR UPDATE`;
    return tx.process.findUniqueOrThrow({ where: { id: processId } });
  }

  async list(
    userId: string,
    processId: string,
    selectedRunId?: string,
    documentId?: string,
    selectedResolvedHash?: string,
  ) {
    if (
      selectedResolvedHash !== undefined &&
      (typeof selectedResolvedHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(selectedResolvedHash))
    )
      throw new BadRequestException("Некорректный хеш снимка идентификации");
    return this.prisma.$transaction(
      async (tx) => {
        const process = await this.permittedProcess(tx, userId, processId);
        const currentRun = await tx.run.findUniqueOrThrow({
          where: { processId_version: { processId, version: process.version } },
        });
        const run = selectedRunId
          ? await tx.run.findFirst({
              where: {
                id: selectedRunId,
                processId,
                objectId: process.objectId,
              },
            })
          : currentRun;
        if (!run) throw new NotFoundException("Запуск недоступен");
        const latest = await IdentificationService.readSnapshot(tx, run.id);
        const saved = selectedResolvedHash
          ? await tx.resolvedInputSnapshot.findUnique({
              where: {
                runId_resolvedInputHash: {
                  runId: run.id,
                  resolvedInputHash: selectedResolvedHash,
                },
              },
            })
          : latest;
        if (selectedResolvedHash && !saved)
          throw new NotFoundException("Снимок отсутствует в выбранном запуске");
        const current = run.id === currentRun.id && saved?.id === latest?.id;
        const versions = await tx.resolvedInputSnapshot.findMany({
          where: { runId: run.id },
          orderBy: { version: "desc" },
          select: { version: true, resolvedInputHash: true, createdAt: true },
        });
        const source = current ? await identificationSources(tx, run.id) : null;
        const task = source
          ? await tx.identificationTask.findUnique({
              where: {
                runId_fingerprint: {
                  runId: run.id,
                  fingerprint: source.fingerprint,
                },
              },
            })
          : null;
        const stale = Boolean(
          source && (!saved || saved.sourceFingerprint !== source.fingerprint),
        );
        const active = source
          ? !source.ready ||
            (stale && task?.state !== "failed") ||
            (await identificationBusy(tx, run.id))
          : false;
        const snapshot = (saved?.snapshot ?? {
          schema_version: 1,
          documents: [],
          document_aliases: [],
          decision_ids: [],
          contexts: [],
          blockers: ["identification_pending"],
        }) as unknown as StoredIdentificationSnapshot;
        const aliases = snapshot.document_aliases ?? [];
        const canonicalId =
          documentId &&
          (aliases.find((alias) => alias.document_id === documentId)
            ?.canonical_document_id ??
            documentId);
        const sourceDocumentIds = canonicalId
          ? aliases
              .filter((alias) => alias.canonical_document_id === canonicalId)
              .map((alias) => alias.document_id)
          : undefined;
        const decisions = await tx.clarification.findMany({
          where: {
            processId,
            id: { in: snapshot.decision_ids ?? [] },
            ...(canonicalId
              ? {
                  documentId: {
                    in: sourceDocumentIds?.length
                      ? sourceDocumentIds
                      : [canonicalId],
                  },
                }
              : {}),
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
        const history = decisions.map((decision) => ({
          id: decision.id,
          document_id: decision.documentId,
          revision_id: decision.revisionId,
          actor_id: decision.actorId,
          request_id: decision.requestId,
          card_version: decision.cardVersion,
          basis: decision.basis,
          patch: decision.patch,
          created_at: decision.createdAt.toISOString(),
          run_id: decision.runId,
        }));
        const result = {
          object_id: process.objectId,
          process_id: processId,
          process_status: process.status,
          current_run_id: currentRun.id,
          run_id: run.id,
          current,
          snapshot_versions: versions.map((version) => ({
            version: version.version,
            resolved_input_hash: version.resolvedInputHash,
            created_at: version.createdAt.toISOString(),
          })),
          active,
          allowed_actions: {
            apply:
              current &&
              EDITABLE.includes(process.status) &&
              !active &&
              !stale &&
              !source?.sources.some((item) => item.file.corruptedAt),
          },
          identification_state:
            task?.state ?? (saved && !stale ? "succeeded" : "queued"),
          error_code: task?.errorCode ?? null,
          resolved_input_hash: saved?.resolvedInputHash ?? null,
          input_manifest_hash: run.inputManifestHash,
          ...snapshot,
          history,
        };
        if (!documentId) return result;
        const document = snapshot.documents.find(
          (item) => item.document_id === canonicalId,
        );
        if (!document)
          throw new NotFoundException(
            "Документ отсутствует в выбранном запуске",
          );
        return { ...result, document };
      },
      { timeout: 20_000 },
    );
  }

  /** Called by the background worker only, after its source/lease fencing. */
  async publish(
    tx: Prisma.TransactionClient,
    source: IdentificationSources,
    identified: { fileId: string; machine: IdentifiedRevision }[],
  ) {
    const existing = await tx.resolvedInputSnapshot.findUnique({
      where: {
        runId_sourceFingerprint: {
          runId: source.run.id,
          sourceFingerprint: source.fingerprint,
        },
      },
    });
    if (existing) return existing;
    for (const item of identified) {
      const input = source.sources.find(
        (value) => value.file.id === item.fileId,
      );
      if (!input?.artifact || !input.parsing) continue;
      const fingerprint = partFingerprint(
        input.artifact.id,
        input.classification?.id ?? null,
      );
      const already = await tx.fileDocumentPart.findUnique({
        where: {
          runId_fileId_sourceFingerprint: {
            runId: source.run.id,
            fileId: item.fileId,
            sourceFingerprint: fingerprint,
          },
        },
      });
      if (already) continue;
      const historical = await tx.fileDocumentPart.findFirst({
        where: { fileId: item.fileId, processId: source.run.processId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      let documentId = historical?.documentId;
      let revisionId = historical?.revisionId;
      if (!documentId || !revisionId) {
        // Keep source identities independent. Strict logical grouping is an
        // immutable snapshot projection with aliases; a later observation may
        // reveal a conflict without overwriting either representation's facts.
        const identityKey = `file:${item.fileId}`;
        const document = await tx.document.upsert({
          where: {
            processId_identityKey: {
              processId: source.run.processId,
              identityKey,
            },
          },
          create: {
            processId: source.run.processId,
            objectId: source.run.objectId,
            identityKey,
          },
          update: {},
        });
        documentId = document.id;
        const revision = await tx.documentRevision.create({
          data: {
            documentId,
            processId: source.run.processId,
            objectId: source.run.objectId,
            identityKey,
          },
        });
        revisionId = revision.id;
      }
      const part = await tx.fileDocumentPart.create({
        data: {
          documentId,
          revisionId,
          objectId: source.run.objectId,
          processId: source.run.processId,
          runId: source.run.id,
          fileId: item.fileId,
          artifactId: input.artifact.id,
          sourceFingerprint: fingerprint,
          firstPage: 1,
          lastPage: Math.max(1, input.artifact.pagesTotal),
          machine: identificationJson(item.machine),
        },
      });
      if (item.machine.candidates.length)
        await tx.fieldCandidate.createMany({
          data: item.machine.candidates.map((candidate) => ({
            partId: part.id,
            field: candidate.field,
            raw: candidate.raw,
            normalized: candidate.normalized,
            role: candidate.role,
            method: candidate.method,
            rulesVersion: candidate.engine_version,
            evidence: identificationJson(candidate.evidence),
          })),
        });
    }
    // A card's reference selection also depends on other source documents.
    // Invalidate every editor participating in the snapshot when any machine
    // observation/policy changes, even if this particular file was unchanged.
    const participating = await tx.fileDocumentPart.findMany({
      where: { runId: source.run.id },
      distinct: ["documentId"],
      select: { documentId: true },
    });
    for (const { documentId: id } of participating)
      await tx.document.update({
        where: { id },
        data: { cardVersion: { increment: 1 } },
      });
    const documents = await this.documentsForSources(tx, source);
    return this.persistSnapshot(tx, source, documents);
  }

  private async documentsForSources(
    tx: Prisma.TransactionClient,
    source: IdentificationSources,
  ) {
    const parts = await tx.fileDocumentPart.findMany({
      where: { runId: source.run.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { revision: { include: { document: true } } },
    });
    const latestParts = source.sources.flatMap((input) => {
      const fingerprint = input.artifact
        ? partFingerprint(input.artifact.id, input.classification?.id ?? null)
        : null;
      const part = parts.find(
        (candidate) =>
          candidate.fileId === input.file.id &&
          candidate.sourceFingerprint === fingerprint,
      );
      return part ? [part] : [];
    });
    const docs = new Map<string, IdentificationDocument>();
    for (const part of latestParts) {
      let document = docs.get(part.documentId);
      if (!document) {
        document = {
          document_id: part.documentId,
          card_version: part.revision.document.cardVersion,
          revisions: [],
        };
        docs.set(part.documentId, document);
      }
      const machine = structuredClone(
        part.machine,
      ) as unknown as IdentifiedRevision;
      const present = document.revisions.find(
        (revision) => revision.revision_id === part.revisionId,
      );
      if (present) {
        present.representations.push(...machine.representations);
        present.candidates.push(...machine.candidates);
        present.blockers = [
          ...new Set([...present.blockers, ...machine.blockers]),
        ];
      } else
        document.revisions.push({ revision_id: part.revisionId, ...machine });
    }
    for (const decision of source.decisions) {
      const revision = docs
        .get(decision.documentId)
        ?.revisions.find((item) => item.revision_id === decision.revisionId);
      if (revision)
        applyPatch(
          revision,
          decision.patch as unknown as RevisionClarification,
        );
    }
    return [...docs.values()].sort((a, b) =>
      a.document_id.localeCompare(b.document_id),
    );
  }

  private async persistSnapshot(
    tx: Prisma.TransactionClient,
    source: IdentificationSources,
    documents: IdentificationDocument[],
  ) {
    const grouped = groupResolvedDocuments(documents);
    const selection = buildSelectionSnapshot(grouped.documents);
    for (const item of source.sources) {
      if (!item.artifact || item.parsing?.state !== "succeeded")
        selection.blockers.push(`parsing_unavailable:${item.file.id}`);
      if (item.file.corruptedAt)
        selection.blockers.push(`source_corrupted:${item.file.id}`);
    }
    selection.blockers = [...new Set(selection.blockers)].sort();
    const snapshot = {
      ...selection,
      object_id: source.run.objectId,
      process_id: source.run.processId,
      run_id: source.run.id,
      input_manifest_hash: source.run.inputManifestHash,
      decision_ids: source.decisions.map((decision) => decision.id).sort(),
      document_aliases: grouped.document_aliases,
      policy_versions: IDENTIFICATION_POLICY_VERSIONS,
    };
    const resolvedInputHash = identificationHash(snapshot);
    const previous = await IdentificationService.readSnapshot(
      tx,
      source.run.id,
    );
    const row = await tx.resolvedInputSnapshot.create({
      data: {
        version: (previous?.version ?? 0) + 1,
        objectId: source.run.objectId,
        processId: source.run.processId,
        runId: source.run.id,
        inputManifestHash: source.run.inputManifestHash,
        resolvedInputHash,
        sourceFingerprint: source.fingerprint,
        snapshot: identificationJson(snapshot),
      },
    });
    await writeOutboxEvent(tx, {
      data: {
        eventType: "identification.resolved",
        payload: {
          schema_version: 1,
          event_type: "identification.resolved",
          object_id: source.run.objectId,
          process_id: source.run.processId,
          run_id: source.run.id,
          resolved_input_hash: resolvedInputHash,
        },
      },
    });
    await this.completeness.evaluateForRun(tx, source.run.id);
    return row;
  }

  async apply(context: AuditContext, processId: string, raw: unknown) {
    let input: ClarificationBatch;
    try {
      input = validateClarificationBatch(raw);
    } catch (error) {
      if (error instanceof IdentificationContractError)
        throw new BadRequestException({
          code: error.code,
          message: "Некорректное уточнение документа",
        });
      throw error;
    }
    const fingerprint = identificationHash(input);
    // This bounded health check is outside the transaction. Unknown/new parser
    // versions use the ordinary background pipeline instead of reusing old OCR.
    const parserFingerprint = await this.parser.fingerprint().catch(() => null);
    const verifiedCache = await this.verifyParsedSources(
      context.userId,
      processId,
      input,
      parserFingerprint,
    );
    return this.prisma.$transaction(
      async (tx) => {
        const process = await this.permittedProcess(
          tx,
          context.userId,
          processId,
        );
        const receipt = await tx.documentResolutionReceipt.findUnique({
          where: {
            userId_processId_requestId: {
              userId: context.userId,
              processId,
              requestId: input.request_id,
            },
          },
        });
        if (receipt) {
          if (receipt.fingerprint !== fingerprint)
            conflict(
              "identification_request_conflict",
              "Ключ запроса уже использован для другого уточнения",
            );
          return { ...(receipt.response as Prisma.JsonObject), replayed: true };
        }
        if (!EDITABLE.includes(process.status))
          conflict(
            "identification_process_locked",
            "Изменение документа в текущем состоянии процесса недоступно",
          );
        const oldRun = await tx.run.findUniqueOrThrow({
          where: { processId_version: { processId, version: process.version } },
        });
        if (oldRun.id !== input.expected_run_id)
          conflict(
            "identification_run_conflict",
            "Состав документов изменился — обновите страницу",
          );
        const source = await identificationSources(tx, oldRun.id);
        if (source.sources.some((item) => item.file.corruptedAt))
          conflict(
            "identification_source_corrupted",
            "Восстановите повреждённый оригинал перед уточнением",
          );
        const saved = await IdentificationService.readSnapshot(tx, oldRun.id);
        if (
          !source.ready ||
          !saved ||
          saved.sourceFingerprint !== source.fingerprint ||
          (await identificationBusy(tx, oldRun.id))
        )
          conflict(
            "identification_processing",
            "Дождитесь завершения обработки документов",
          );
        const stored =
          saved.snapshot as unknown as StoredIdentificationSnapshot;
        const documents = structuredClone(stored.documents);
        const aliases =
          stored.document_aliases ??
          documents.flatMap((document) =>
            document.revisions.map((revision) => ({
              document_id: document.document_id,
              revision_id: revision.revision_id,
              card_version: document.card_version,
              canonical_document_id: document.document_id,
              canonical_revision_id: revision.revision_id,
            })),
          );
        // Grouping is a snapshot projection. Persist the same human decision on
        // every original representation, so later retries cannot split a reviewed
        // card merely because only its canonical source received the override.
        const decisions = new Map<
          string,
          {
            documentId: string;
            revisionId: string;
            expectedVersion: number;
            patch: RevisionClarification;
          }
        >();
        const editedVersions = new Map<string, number>();
        for (const edit of input.documents) {
          const document = documents.find(
            (item) => item.document_id === edit.document_id,
          );
          const live = await tx.document.findFirst({
            where: {
              id: edit.document_id,
              processId,
              objectId: process.objectId,
            },
          });
          if (!document || !live)
            throw new NotFoundException(
              "Документ отсутствует в текущем запуске",
            );
          if (
            document.card_version !== edit.expected_version ||
            live.cardVersion !== edit.expected_version
          )
            conflict(
              "identification_version_conflict",
              "Документ уже изменён — обновите карточку",
            );
          const originals = aliases.filter(
            (alias) => alias.canonical_document_id === document.document_id,
          );
          for (const alias of originals) {
            const original = await tx.document.findFirst({
              where: {
                id: alias.document_id,
                processId,
                objectId: process.objectId,
              },
            });
            if (!original || original.cardVersion !== alias.card_version)
              conflict(
                "identification_version_conflict",
                "Представление документа изменилось — обновите карточку",
              );
          }
          for (const patch of edit.revisions) {
            const revision = document.revisions.find(
              (item) => item.revision_id === patch.revision_id,
            );
            if (!revision)
              throw new BadRequestException(
                "Редакция не относится к документу текущего запуска",
              );
            await this.validateKind(tx, patch, revision);
            applyPatch(revision, patch);
            for (const alias of originals.filter(
              (item) => item.canonical_revision_id === patch.revision_id,
            )) {
              editedVersions.set(alias.document_id, alias.card_version);
              decisions.set(alias.revision_id, {
                documentId: alias.document_id,
                revisionId: alias.revision_id,
                expectedVersion: alias.card_version,
                patch: { ...patch, revision_id: alias.revision_id },
              });
            }
          }
          document.card_version++;
        }
        this.validateLinks(documents);
        const runId = randomUUID();
        const version = process.version + 1;
        const priorManifest = oldRun.inputManifest as Prisma.JsonObject;
        const ruleRelease = await pinRunRelease(tx, context.userId);
        const manifest = {
          ...priorManifest,
          run_id: runId,
          versions: {
            ...((priorManifest.versions as Prisma.JsonObject) ?? {}),
            decisions: input.request_id,
            rules: ruleRelease.manifestHash,
          },
        };
        await tx.process.update({
          where: { id: processId },
          data: { version, status: "PENDING" },
        });
        await tx.run.create({
          data: {
            id: runId,
            objectId: process.objectId,
            processId,
            version,
            inputManifest: identificationJson(manifest),
            inputManifestHash: identificationHash(manifest),
            ruleSetReleaseId: ruleRelease.id,
          },
        });
        await tx.runInput.createMany({
          data: source.sources.map(({ file }) => ({
            runId,
            processId,
            objectId: process.objectId,
            fileId: file.id,
          })),
        });
        for (const id of editedVersions.keys())
          await tx.document.update({
            where: { id },
            data: { cardVersion: { increment: 1 } },
          });
        for (const decision of decisions.values())
          await tx.clarification.create({
            data: {
              documentId: decision.documentId,
              revisionId: decision.revisionId,
              objectId: process.objectId,
              processId,
              runId,
              actorId: context.userId,
              requestId: input.request_id,
              cardVersion: decision.expectedVersion,
              basis: input.basis,
              patch: identificationJson(decision.patch),
            },
          });
        await this.reuseParsedSources(
          tx,
          source,
          runId,
          parserFingerprint,
          verifiedCache,
        );
        const nextSource = await identificationSources(tx, runId);
        const nextDocuments = await this.documentsForSources(tx, nextSource);
        const nextSnapshot = nextSource.ready
          ? await this.persistSnapshot(tx, nextSource, nextDocuments)
          : null;
        const job = await tx.job.create({
          data: {
            runId,
            processId,
            objectId: process.objectId,
            kind: "document.parsing",
          },
        });
        const eventId = randomUUID();
        await writeOutboxEvent(tx, {
          data: {
            id: eventId,
            jobId: job.id,
            eventType: "documents.accepted",
            payload: {
              schema_version: 1,
              event_id: eventId,
              event_type: "documents.accepted",
              occurred_at: new Date().toISOString(),
              object_id: process.objectId,
              process_id: processId,
              run_id: runId,
              job_id: job.id,
              input_manifest_hash: nextSource.run.inputManifestHash,
              request_id: context.requestId,
            },
          },
        });
        await writeAuditEvent(tx, {
          data: {
            ...context,
            objectId: process.objectId,
            action: "identification.resolved",
            details: {
              schema_version: 1,
              request_id: input.request_id,
              process_id: processId,
              previous_run_id: oldRun.id,
              run_id: runId,
              document_ids: input.documents.map((item) => item.document_id),
              resolved_input_hash: nextSnapshot?.resolvedInputHash ?? null,
            },
          },
        });
        const response = {
          schema_version: 1,
          request_id: input.request_id,
          process_id: processId,
          run_id: runId,
          previous_run_id: oldRun.id,
          resolved_input_hash: nextSnapshot?.resolvedInputHash ?? null,
          replayed: false,
        };
        await tx.documentResolutionReceipt.create({
          data: {
            userId: context.userId,
            processId,
            requestId: input.request_id,
            fingerprint,
            response: identificationJson(response),
          },
        });
        return response;
      },
      { timeout: 60_000 },
    );
  }

  private async validateKind(
    tx: Prisma.TransactionClient,
    patch: RevisionClarification,
    revision: IdentificationRevision,
  ) {
    const fields = { ...revision.fields, ...patch.fields };
    if (
      patch.fields?.kind_code !== undefined ||
      patch.fields?.stage !== undefined
    ) {
      if (!fields.kind_code) return;
      const stage = fields.stage;
      if (!stage)
        throw new BadRequestException("Для вида документа требуется стадия");
      const kinds: Record<string, string[]> = {
        PD: ["pd_section"],
        RD: ["rd_mark", "rd_component"],
        ID: ["id_kind"],
      };
      const framework = await tx.frameworkSet.findFirst({
        where: { status: "approved" },
        orderBy: { version: "desc" },
      });
      const entry =
        framework &&
        (await tx.frameworkVocabulary.findFirst({
          where: {
            setId: framework.id,
            code: fields.kind_code,
            kind: { in: kinds[stage] ?? [] },
          },
        }));
      if (!entry || entry.code === "SET")
        throw new BadRequestException(
          "Вид документа не принадлежит словарю выбранной стадии",
        );
    }
  }

  private validateLinks(documents: IdentificationDocument[]) {
    const identity = (value: string | undefined) =>
      normalizeIdentificationText(value ?? "").toLocaleLowerCase("ru-RU");
    const revisions = documents.flatMap((doc) => doc.revisions);
    const byId = new Map(
      revisions.map((revision) => [revision.revision_id, revision]),
    );
    for (const revision of revisions) {
      try {
        validateRevisionSheetMap(revision);
        const sheetErrors = resolveSheetSet(
          documents,
          revision.revision_id,
        ).blockers;
        if (sheetErrors.length)
          throw new IdentificationContractError(sheetErrors[0]!);
      } catch (error) {
        if (error instanceof IdentificationContractError)
          throw new BadRequestException({
            code: error.code,
            message: "Проверьте карту листов и основание частичной замены",
          });
        throw error;
      }
      if (
        revision.fields.works_from &&
        revision.fields.works_to &&
        revision.fields.works_from > revision.fields.works_to
      )
        throw new BadRequestException("Начало работ позже окончания");
      const reference = revision.reference_revision_id;
      if (
        reference &&
        (!byId.has(reference) ||
          reference === revision.revision_id ||
          !["PD", "RD"].includes(byId.get(reference)!.fields.stage ?? ""))
      )
        throw new BadRequestException("Недопустимая ссылка на редакцию");
      const seen = new Set([revision.revision_id]);
      let parent = predecessorId(revision);
      while (parent) {
        const prior = byId.get(parent);
        if (!prior || seen.has(parent))
          throw new BadRequestException(
            "Недопустимая или циклическая цепочка редакций",
          );
        if (
          prior.fields.stage !== revision.fields.stage ||
          !identity(prior.fields.code) ||
          identity(prior.fields.code) !== identity(revision.fields.code) ||
          identity(prior.fields.scope) !== identity(revision.fields.scope)
        )
          throw new BadRequestException(
            "Заменяемая редакция должна относиться к тому же документу и области",
          );
        seen.add(parent);
        parent = predecessorId(prior);
      }
    }
  }

  private async verifyParsedSources(
    userId: string,
    processId: string,
    input: ClarificationBatch,
    currentFingerprint: string | null,
  ) {
    const verified = new Set<string>();
    if (!currentFingerprint) return verified;
    const sources = await this.prisma.$transaction(async (tx) => {
      const process = await this.permittedProcess(tx, userId, processId);
      const receipt = await tx.documentResolutionReceipt.findUnique({
        where: {
          userId_processId_requestId: {
            userId,
            processId,
            requestId: input.request_id,
          },
        },
      });
      if (receipt || !EDITABLE.includes(process.status)) return [];
      const run = await tx.run.findFirst({
        where: {
          id: input.expected_run_id,
          processId,
          version: process.version,
        },
      });
      if (!run) return [];
      return (await identificationSources(tx, run.id)).sources.filter(
        (source) =>
          source.parsing?.state === "succeeded" &&
          source.artifact?.pipelineFingerprint === currentFingerprint &&
          source.artifact.sourceSha256 === source.file.sha256 &&
          !source.file.corruptedAt,
      );
    });
    // Validate outside the mutation transaction. A large batch can finish in
    // the ordinary PAR cache path; HTTP only attempts a bounded quick reuse.
    const deadline = Date.now() + 5_000;
    const signal = AbortSignal.timeout(5_000);
    for (const source of sources) {
      if (Date.now() >= deadline) break;
      const artifact = source.artifact!;
      try {
        const value = await this.artifacts.read(
          artifact.storageKey,
          artifact.artifactSha256,
          source.file.sha256,
          currentFingerprint,
        );
        await this.artifacts.verifyImages(value, signal);
        verified.add(cacheIdentity(source)!);
      } catch {
        // Corrupt/obsolete cache data must not become a ready snapshot. The
        // standard PAR worker verifies again and reparses when reuse fails.
      }
    }
    return verified;
  }

  private async reuseParsedSources(
    tx: Prisma.TransactionClient,
    source: IdentificationSources,
    runId: string,
    currentFingerprint: string | null,
    verifiedCache: Set<string>,
  ) {
    for (const input of source.sources) {
      const old = input.parsing;
      if (
        !old ||
        !currentFingerprint ||
        input.artifact?.pipelineFingerprint !== currentFingerprint ||
        !verifiedCache.has(cacheIdentity(input) ?? "") ||
        old.state !== "succeeded"
      )
        continue;
      const task = await tx.parsingTask.create({
        data: {
          runId,
          processId: source.run.processId,
          objectId: source.run.objectId,
          fileId: input.file.id,
          cycle: 1,
          state: old.state,
          attempts: 0,
          pipelineFingerprint: old.pipelineFingerprint,
          pagesCompleted: old.pagesCompleted,
          pagesTotal: old.pagesTotal,
          errorCode: old.errorCode,
          completedAt: new Date(),
        },
      });
      if (!input.artifact) continue;
      const oldArtifact = input.artifact;
      const artifact = await tx.parseArtifact.create({
        data: {
          taskId: task.id,
          sourceSha256: oldArtifact.sourceSha256,
          pipelineFingerprint: oldArtifact.pipelineFingerprint,
          storageKey: oldArtifact.storageKey,
          artifactSha256: oldArtifact.artifactSha256,
          quality: oldArtifact.quality,
          reasons: oldArtifact.reasons,
          pagesTotal: oldArtifact.pagesTotal,
        },
      });
      let classificationId: string | null = null;
      if (input.classification) {
        const oldClassification = input.classification;
        const copied = await tx.classificationTask.create({
          data: {
            artifactId: artifact.id,
            cycle: 1,
            fingerprint: oldClassification.fingerprint,
            state: oldClassification.state,
            attempts: 0,
            result:
              oldClassification.result === null
                ? undefined
                : identificationJson(oldClassification.result),
            errorCode: oldClassification.errorCode,
            completedAt: new Date(),
          },
        });
        classificationId = copied.id;
      }
      const oldPart = await tx.fileDocumentPart.findUnique({
        where: {
          runId_fileId_sourceFingerprint: {
            runId: source.run.id,
            fileId: input.file.id,
            sourceFingerprint: partFingerprint(
              oldArtifact.id,
              input.classification?.id ?? null,
            ),
          },
        },
      });
      if (!oldPart) continue;
      const machine = structuredClone(
        oldPart.machine,
      ) as unknown as IdentifiedRevision;
      for (const representation of machine.representations)
        if (representation.artifact_id === oldArtifact.id)
          representation.artifact_id = artifact.id;
      for (const candidate of machine.candidates)
        for (const evidence of candidate.evidence)
          if (evidence.artifact_id === oldArtifact.id)
            evidence.artifact_id = artifact.id;
      const nextPart = await tx.fileDocumentPart.create({
        data: {
          documentId: oldPart.documentId,
          revisionId: oldPart.revisionId,
          objectId: source.run.objectId,
          processId: source.run.processId,
          runId,
          fileId: input.file.id,
          artifactId: artifact.id,
          firstPage: oldPart.firstPage,
          lastPage: oldPart.lastPage,
          sourceFingerprint: partFingerprint(artifact.id, classificationId),
          machine: identificationJson(machine),
        },
      });
      if (machine.candidates.length)
        await tx.fieldCandidate.createMany({
          data: machine.candidates.map((candidate) => ({
            partId: nextPart.id,
            field: candidate.field,
            raw: candidate.raw,
            normalized: candidate.normalized,
            role: candidate.role,
            method: candidate.method,
            rulesVersion: candidate.engine_version,
            evidence: identificationJson(candidate.evidence),
          })),
        });
    }
  }

  /** Compatibility route uses the same receipt/version/basis contract. */
  async resolveKind(
    context: AuditContext,
    objectId: string,
    fileId: string,
    input: {
      request_id: string;
      expected_run_id: string;
      expected_version: number;
      basis: string;
      kind_code: string;
      stage: ClassificationStage;
    },
  ) {
    const target = await this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, context.userId, objectId);
      const file = await tx.file.findFirst({ where: { id: fileId, objectId } });
      if (!file) throw new NotFoundException("Файл недоступен");
      const part = await tx.fileDocumentPart.findFirst({
        where: { fileId, runId: input.expected_run_id },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      if (!part)
        conflict(
          "identification_pending",
          "Сначала дождитесь идентификации документа",
        );
      const snapshot = await IdentificationService.readSnapshot(
        tx,
        input.expected_run_id,
      );
      const aliases =
        (
          snapshot?.snapshot as unknown as
            StoredIdentificationSnapshot | undefined
        )?.document_aliases ?? [];
      const alias = aliases.find(
        (item) =>
          item.document_id === part.documentId &&
          item.revision_id === part.revisionId,
      );
      return {
        processId: file.processId,
        documentId: alias?.canonical_document_id ?? part.documentId,
        revisionId: alias?.canonical_revision_id ?? part.revisionId,
      };
    });
    return this.apply(context, target.processId, {
      request_id: input.request_id,
      expected_run_id: input.expected_run_id,
      basis: input.basis,
      documents: [
        {
          document_id: target.documentId,
          expected_version: input.expected_version,
          revisions: [
            {
              revision_id: target.revisionId,
              fields: { kind_code: input.kind_code, stage: input.stage },
            },
          ],
        },
      ],
    });
  }
}
