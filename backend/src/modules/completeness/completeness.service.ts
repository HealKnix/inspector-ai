import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client.js";
import { writeAuditEvent } from "../../infrastructure/audit/audit-envelope.js";
import { writeOutboxEvent } from "../../infrastructure/observability/trace-context.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import type { IdentificationSnapshot } from "../identification/identification-contract.js";
import {
  ObjectAccessService,
  type AuditContext,
} from "../objects/object-access.service.js";
import { ArtifactStorageService } from "../parsing/artifact-storage.service.js";
import type {
  ExpectedRequirement,
  RequirementQuantity,
  Stage,
} from "./completeness-contract.js";
import {
  documentFactsFromSnapshot,
  evaluate,
  isApplicable,
} from "./completeness-engine.js";
import { extractListItems } from "./completeness-extract.js";

function toApiQuantity(quantity: RequirementQuantity) {
  return { min: quantity.min, per: quantity.per ? "list_item" : "object" };
}

@Injectable()
export class CompletenessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: ObjectAccessService,
    private readonly artifacts: ArtifactStorageService,
  ) {}

  private async latestFramework(tx: Prisma.TransactionClient) {
    const set = await tx.frameworkSet.findFirst({
      where: { status: "approved" },
      orderBy: { version: "desc" },
      include: { requirements: true },
    });
    if (!set)
      throw new ConflictException(
        "Нет утверждённого нормативного каркаса (framework_set)",
      );
    return set;
  }

  private serializeRequirement(requirement: {
    id: string;
    code: string;
    stage: string;
    kindCode: string;
    title: string;
    scope: unknown;
    quantity: unknown;
    alternatives: unknown;
    origin: string;
    excluded: boolean;
    exclusionReason: string | null;
    source: unknown;
  }) {
    return {
      id: requirement.id,
      code: requirement.code,
      stage: requirement.stage,
      kind_code: requirement.kindCode,
      title: requirement.title,
      scope: requirement.scope,
      quantity: toApiQuantity(
        (requirement.quantity ?? { min: 1 }) as RequirementQuantity,
      ),
      alternatives: requirement.alternatives,
      origin: requirement.origin,
      excluded: requirement.excluded,
      exclusion_reason: requirement.exclusionReason,
      source: requirement.source,
    };
  }

  async getPackage(userId: string, objectId: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, userId, objectId);
      const latest = await tx.packageVersion.findFirst({
        where: { objectId },
        orderBy: { version: "desc" },
        include: {
          frameworkSet: true,
          requirements: { orderBy: { code: "asc" } },
          listItems: { orderBy: [{ listKind: "asc" }, { itemKey: "asc" }] },
        },
      });
      if (!latest)
        return {
          schema_version: 1,
          object_id: objectId,
          package: null,
          package_absent_reason: "package_not_generated",
        };
      return {
        schema_version: 1,
        object_id: objectId,
        package: {
          version: latest.version,
          status: latest.status,
          framework_version: latest.frameworkSet.version,
          attributes: latest.attributes,
          confirmed_by: latest.confirmedBy,
          confirmed_at: latest.confirmedAt?.toISOString() ?? null,
          basis: latest.basis,
          list_items: latest.listItems.map((item) => ({
            id: item.id,
            list_kind: item.listKind,
            item_key: item.itemKey,
            title: item.title,
            source: item.source,
          })),
          requirements: latest.requirements.map((requirement) =>
            this.serializeRequirement(requirement),
          ),
          requirements_total: latest.requirements.filter(
            (requirement) => !requirement.excluded,
          ).length,
        },
        package_absent_reason: null,
      };
    });
  }

  private async extractCandidates(objectId: string) {
    const rows = await this.prisma.$queryRaw<
      {
        file_id: string;
        storage_key: string;
        artifact_sha256: string;
        source_sha256: string;
        pipeline_fingerprint: string;
      }[]
    >`
      SELECT f.id AS file_id, a.storage_key, a.artifact_sha256, a.source_sha256,
             a.pipeline_fingerprint
      FROM processes p
      JOIN runs r ON r.process_id = p.id AND r.version = p.version
      JOIN run_inputs ri ON ri.run_id = r.id
      JOIN files f ON f.id = ri.file_id
      JOIN LATERAL (SELECT * FROM parsing_tasks pt WHERE pt.run_id = r.id
        AND pt.file_id = f.id ORDER BY cycle DESC LIMIT 1) t
        ON t.state = 'succeeded'
      JOIN parse_artifacts a ON a.task_id = t.id
      WHERE p.object_id = ${objectId}::uuid AND f.corrupted_at IS NULL`;
    const items: ReturnType<typeof extractListItems> = [];
    for (const row of rows) {
      try {
        const artifact = await this.artifacts.read(
          row.storage_key,
          row.artifact_sha256,
          row.source_sha256,
          row.pipeline_fingerprint,
          "stored",
        );
        items.push(...extractListItems(row.file_id, artifact.pages));
      } catch {
        // Повреждённый или нечитаемый артефакт не должен ломать предложение —
        // кандидаты просто отсутствуют, инспектор видит источники.
      }
    }
    return items;
  }

  async generate(
    context: AuditContext,
    objectId: string,
    input: {
      attributes: Record<string, unknown>;
      lists?: { list_kind: string; item_key: string; title: string }[];
    },
  ) {
    const extracted = await this.extractCandidates(objectId);
    return this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, context.userId, objectId);
      const framework = await this.latestFramework(tx);
      const last = await tx.packageVersion.findFirst({
        where: { objectId },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const version = await tx.packageVersion.create({
        data: {
          objectId,
          version: (last?.version ?? 0) + 1,
          status: "proposed",
          frameworkSetId: framework.id,
          attributes: input.attributes as Prisma.InputJsonValue,
          createdBy: context.userId,
        },
      });
      const listItems = [
        ...extracted.map((item) => ({
          listKind: item.listKind,
          itemKey: item.itemKey,
          title: item.title,
          source: item.source,
        })),
        ...(input.lists ?? []).map((item) => ({
          listKind: item.list_kind,
          itemKey: item.item_key,
          title: item.title,
          source: { manual: true },
        })),
      ];
      const seen = new Set<string>();
      const storedItems = new Map<string, string>();
      for (const item of listItems) {
        const key = `${item.listKind}:${item.itemKey.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const stored = await tx.packageListItem.create({
          data: { packageVersionId: version.id, ...item },
        });
        storedItems.set(key, stored.id);
      }
      const requirements: {
        frameworkRequirementId: string;
        listItemId: string | null;
        code: string;
        stage: string;
        kindCode: string;
        title: string;
        scope: Prisma.InputJsonValue | null;
        quantity: Prisma.InputJsonValue;
        alternatives: Prisma.InputJsonValue | null;
        source: Prisma.InputJsonValue;
      }[] = [];
      for (const rule of framework.requirements) {
        if (!isApplicable(rule.applicability, input.attributes)) continue;
        const quantity = (rule.quantity ?? { min: 1 }) as {
          min: number;
          per?: string;
        };
        const source = {
          norm_ref: rule.normRef,
          framework_code: rule.code,
        } as Prisma.InputJsonValue;
        if (quantity.per) {
          const items = [...storedItems.entries()].filter(([key]) =>
            key.startsWith(`${quantity.per}:`),
          );
          for (const [key, itemId] of items) {
            const itemKey = key.slice(quantity.per.length + 1);
            const original = listItems.find(
              (item) =>
                `${item.listKind}:${item.itemKey.toLowerCase()}` === key,
            );
            const title = original?.itemKey ?? itemKey;
            requirements.push({
              frameworkRequirementId: rule.id,
              listItemId: itemId,
              code: `${rule.code}#${itemKey}`,
              stage: rule.stage,
              // Для марок РД элемент перечня — сам код марки; для перечней
              // ИД вид документа остаётся из шаблона, а элемент уходит в scope.
              kindCode: quantity.per === "rd_marks" ? title : rule.kindCode,
              title: `${rule.title} — ${title}`,
              scope: { item: title },
              quantity: { min: quantity.min, per: quantity.per },
              alternatives: rule.alternatives ?? null,
              source,
            });
          }
        } else {
          requirements.push({
            frameworkRequirementId: rule.id,
            listItemId: null,
            code: rule.code,
            stage: rule.stage,
            kindCode: rule.kindCode,
            title: rule.title,
            scope: null,
            quantity: { min: quantity.min, per: null },
            alternatives: rule.alternatives ?? null,
            source,
          });
        }
      }
      for (const requirement of requirements) {
        await tx.packageRequirement.create({
          data: {
            packageVersionId: version.id,
            frameworkRequirementId: requirement.frameworkRequirementId,
            listItemId: requirement.listItemId,
            code: requirement.code,
            stage: requirement.stage,
            kindCode: requirement.kindCode,
            title: requirement.title,
            scope: requirement.scope ?? undefined,
            quantity: requirement.quantity,
            alternatives: requirement.alternatives ?? undefined,
            origin: "framework",
            source: requirement.source,
          },
        });
      }
      await writeAuditEvent(tx, {
        data: {
          ...context,
          objectId,
          action: "expected_package.generated",
          details: {
            schema_version: 1,
            package_version_id: version.id,
            version: version.version,
            framework_set_id: framework.id,
            framework_version: framework.version,
            requirements: requirements.length,
            list_items: storedItems.size,
            extracted_candidates: extracted.length,
          },
        },
      });
      return {
        schema_version: 1,
        object_id: objectId,
        package_version: version.version,
        status: version.status,
        requirements: requirements.length,
        list_items: storedItems.size,
        extracted_candidates: extracted.length,
      };
    });
  }

  async confirm(
    context: AuditContext,
    objectId: string,
    input: {
      request_id: string;
      expected_version: number;
      basis: string;
      attributes: Record<string, unknown>;
      exclude?: { requirement_id: string; reason: string }[];
      include?: {
        stage: Stage;
        kind_code: string;
        title: string;
        scope?: unknown;
        quantity?: { min: number; per?: string };
        alternatives?: unknown;
        source?: unknown;
      }[];
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, context.userId, objectId);
      const receipt = await tx.packageConfirmReceipt.findUnique({
        where: {
          userId_objectId_requestId: {
            userId: context.userId,
            objectId,
            requestId: input.request_id,
          },
        },
      });
      if (receipt) {
        const existing = await tx.packageVersion.findUniqueOrThrow({
          where: { id: receipt.packageVersionId },
        });
        return {
          schema_version: 1,
          object_id: objectId,
          package_version: existing.version,
        };
      }
      const seen = await tx.packageVersion.findFirst({
        where: { objectId, version: input.expected_version },
        include: { requirements: true, listItems: true },
      });
      if (!seen)
        throw new ConflictException(
          `Версия перечня ${input.expected_version} недоступна`,
        );
      const last = await tx.packageVersion.findFirst({
        where: { objectId },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      if (last && last.version !== input.expected_version)
        throw new ConflictException(
          `Перечень изменился: актуальная версия ${last.version}, передана ${input.expected_version}`,
        );
      const excluded = new Map(
        (input.exclude ?? []).map((item) => [item.requirement_id, item.reason]),
      );
      const version = await tx.packageVersion.create({
        data: {
          objectId,
          processId: seen.processId,
          version: input.expected_version + 1,
          status: "confirmed",
          frameworkSetId: seen.frameworkSetId,
          attributes: input.attributes as Prisma.InputJsonValue,
          basis: input.basis,
          createdBy: context.userId,
          confirmedBy: context.userId,
          confirmedAt: new Date(),
        },
      });
      const itemIds = new Map<string, string>();
      for (const item of seen.listItems) {
        const copy = await tx.packageListItem.create({
          data: {
            packageVersionId: version.id,
            listKind: item.listKind,
            itemKey: item.itemKey,
            title: item.title,
            source: (item.source ?? undefined) as Prisma.InputJsonValue,
          },
        });
        itemIds.set(item.id, copy.id);
      }
      for (const requirement of seen.requirements) {
        await tx.packageRequirement.create({
          data: {
            packageVersionId: version.id,
            frameworkRequirementId: requirement.frameworkRequirementId,
            listItemId: requirement.listItemId
              ? (itemIds.get(requirement.listItemId) ?? null)
              : null,
            code: requirement.code,
            stage: requirement.stage,
            kindCode: requirement.kindCode,
            title: requirement.title,
            scope: (requirement.scope ?? undefined) as Prisma.InputJsonValue,
            quantity: requirement.quantity as Prisma.InputJsonValue,
            alternatives: (requirement.alternatives ??
              undefined) as Prisma.InputJsonValue,
            origin: requirement.origin,
            excluded: excluded.has(requirement.id),
            exclusionReason: excluded.get(requirement.id) ?? null,
            source: (requirement.source ?? undefined) as Prisma.InputJsonValue,
          },
        });
      }
      for (const item of input.include ?? []) {
        await tx.packageRequirement.create({
          data: {
            packageVersionId: version.id,
            code: `MANUAL-${item.stage}-${item.kind_code}-${item.title.slice(0, 40)}`,
            stage: item.stage,
            kindCode: item.kind_code,
            title: item.title,
            scope: (item.scope ?? undefined) as Prisma.InputJsonValue,
            quantity: item.quantity ?? {
              min: 1,
              per: null,
            },
            alternatives: (item.alternatives ??
              undefined) as Prisma.InputJsonValue,
            origin: "manual",
            source: (item.source ?? null) as Prisma.InputJsonValue,
          },
        });
      }
      await tx.packageConfirmReceipt.create({
        data: {
          userId: context.userId,
          objectId,
          requestId: input.request_id,
          packageVersionId: version.id,
        },
      });
      await writeOutboxEvent(tx, {
        data: {
          eventType: "expected-composition.confirmed",
          payload: {
            schema_version: 1,
            object_id: objectId,
            process_id: seen.processId,
            package_version_id: version.id,
            package_version: version.version,
            actor: context.userId,
          },
        },
      });
      await writeAuditEvent(tx, {
        data: {
          ...context,
          objectId,
          action: "expected_package.confirmed",
          details: {
            schema_version: 1,
            package_version_id: version.id,
            version: version.version,
            basis: input.basis,
            excluded: excluded.size,
            included: input.include?.length ?? 0,
            request_id: input.request_id,
          },
        },
      });
      return {
        schema_version: 1,
        object_id: objectId,
        package_version: version.version,
      };
    });
  }

  /**
   * Internal publication hook. The caller holds the object's mutation lock.
   * Reuses a result only for the same Run, ID selection and confirmed package.
   */
  async evaluateForRun(
    tx: Prisma.TransactionClient,
    runId: string,
    actor?: AuditContext,
  ) {
    const run = await tx.run.findUnique({
      where: { id: runId },
      include: { process: true },
    });
    if (!run || run.version !== run.process.version) return null;
    const selection = await tx.resolvedInputSnapshot.findFirst({
      where: {
        runId,
        objectId: run.objectId,
        inputManifestHash: run.inputManifestHash,
      },
      orderBy: { version: "desc" },
    });
    if (!selection) return null;
    const pack = await tx.packageVersion.findFirst({
      where: { objectId: run.objectId, status: "confirmed" },
      orderBy: { version: "desc" },
      include: { requirements: true, frameworkSet: true },
    });
    const author = actor?.userId ?? pack?.confirmedBy;
    if (!pack || !author) return null;
    const previous = await tx.completenessResult.findFirst({
      where: {
        runId,
        packageVersionId: pack.id,
        inputRefs: {
          path: ["resolved_input_hash"],
          equals: selection.resolvedInputHash,
        },
      },
      orderBy: { createdAt: "desc" },
    });
    if (previous)
      return this.serializeResult(
        previous,
        previous.result,
        pack.version,
        pack.frameworkSet.version,
        selection.resolvedInputHash,
      );
    const snapshot = selection.snapshot as unknown as IdentificationSnapshot;
    if (
      snapshot.schema_version !== 1 ||
      !Array.isArray(snapshot.documents) ||
      !Array.isArray(snapshot.contexts)
    )
      throw new ConflictException(
        "Снимок идентификации несовместим — оценка невозможна",
      );
    const documents = documentFactsFromSnapshot(snapshot);
    const requirements: ExpectedRequirement[] = pack.requirements.map(
      (requirement) => ({
        id: requirement.id,
        code: requirement.code,
        stage: requirement.stage as Stage,
        kind_code: requirement.kindCode,
        title: requirement.title,
        scope: requirement.scope as ExpectedRequirement["scope"],
        quantity: (requirement.quantity ?? {
          min: 1,
          per: null,
        }) as unknown as RequirementQuantity,
        alternatives:
          (requirement.alternatives as ExpectedRequirement["alternatives"]) ??
          null,
        excluded: requirement.excluded,
      }),
    );
    const evaluation = evaluate(requirements, documents);
    const result = await tx.completenessResult.create({
      data: {
        objectId: run.objectId,
        processId: run.processId,
        runId,
        packageVersionId: pack.id,
        inputRefs: {
          schema_version: 1,
          input_manifest_hash: run.inputManifestHash,
          resolved_input_hash: selection.resolvedInputHash,
          resolved_input_snapshot_id: selection.id,
          framework_set_id: pack.frameworkSetId,
          framework_version: pack.frameworkSet.version,
          package_version: pack.version,
          documents: documents.length,
          document_ids: documents.map((document) => document.document_id!),
        },
        result: evaluation as unknown as Prisma.InputJsonValue,
        createdBy: author,
      },
    });
    await writeAuditEvent(tx, {
      data: {
        userId: author,
        requestId: actor?.requestId ?? selection.id,
        ...(actor?.ip ? { ip: actor.ip } : {}),
        objectId: run.objectId,
        action: "completeness.evaluated",
        details: {
          schema_version: 1,
          result_id: result.id,
          run_id: runId,
          resolved_input_hash: selection.resolvedInputHash,
          package_version_id: pack.id,
          package_version: pack.version,
          scenario: evaluation.scenario,
          counts: evaluation.counts,
        },
      },
    });
    return this.serializeResult(
      result,
      evaluation,
      pack.version,
      pack.frameworkSet.version,
      selection.resolvedInputHash,
    );
  }

  async evaluate(
    context: AuditContext,
    objectId: string,
    input: { run_id?: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, context.userId, objectId);
      const run = await tx.run.findFirst({
        where: { objectId, ...(input.run_id ? { id: input.run_id } : {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { process: true },
      });
      if (!run) throw new NotFoundException("Запуск обработки недоступен");
      if (run.version !== run.process.version)
        throw new ConflictException("Исторический запуск нельзя пересчитать");
      const result = await this.evaluateForRun(tx, run.id, context);
      if (!result)
        throw new ConflictException(
          "Нужны подтверждённый состав и готовый снимок идентификации этого запуска",
        );
      return result;
    });
  }

  private serializeResult(
    result: {
      id: string;
      objectId: string;
      processId: string;
      runId: string;
      createdAt: Date;
    },
    evaluation: unknown,
    packageVersion: number,
    frameworkVersion: number,
    resolvedInputHash: string,
  ) {
    return {
      schema_version: 1,
      object_id: result.objectId,
      process_id: result.processId,
      run_id: result.runId,
      resolved_input_hash: resolvedInputHash,
      package_version: packageVersion,
      framework_version: frameworkVersion,
      evaluated_at: result.createdAt.toISOString(),
      evaluation,
      evaluation_absent_reason: null,
    };
  }

  async getResult(userId: string, objectId: string, runId?: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.access.lock(tx, objectId);
      await this.access.requireAccess(tx, userId, objectId);
      const run = await tx.run.findFirst({
        where: { objectId, ...(runId ? { id: runId } : {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { process: true },
      });
      if (runId && !run)
        throw new NotFoundException("Запуск обработки недоступен");
      const selection = run
        ? await tx.resolvedInputSnapshot.findFirst({
            where: {
              runId: run.id,
              objectId,
              inputManifestHash: run.inputManifestHash,
            },
            orderBy: { version: "desc" },
          })
        : null;
      const currentPackage =
        run?.version === run?.process.version
          ? await tx.packageVersion.findFirst({
              where: { objectId, status: "confirmed" },
              orderBy: { version: "desc" },
            })
          : null;
      const result =
        selection && run
          ? await tx.completenessResult.findFirst({
              where: {
                objectId,
                runId: run.id,
                ...(currentPackage
                  ? { packageVersionId: currentPackage.id }
                  : {}),
                inputRefs: {
                  path: ["resolved_input_hash"],
                  equals: selection.resolvedInputHash,
                },
              },
              orderBy: { createdAt: "desc" },
              include: { packageVersion: { include: { frameworkSet: true } } },
            })
          : null;
      if (!result || !selection)
        return {
          schema_version: 1,
          object_id: objectId,
          process_id: run?.processId ?? null,
          run_id: run?.id ?? runId ?? null,
          resolved_input_hash: selection?.resolvedInputHash ?? null,
          package_version: null,
          framework_version: null,
          evaluated_at: null,
          evaluation: null,
          evaluation_absent_reason: "not_evaluated",
        };
      return this.serializeResult(
        result,
        result.result,
        result.packageVersion.version,
        result.packageVersion.frameworkSet.version,
        selection.resolvedInputHash,
      );
    });
  }
}
