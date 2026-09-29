import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "../../generated/prisma/client.js";
import type { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import type { ObjectAccessService } from "../objects/object-access.service.js";
import type { ArtifactStorageService } from "../parsing/artifact-storage.service.js";
import { CompletenessService } from "./completeness.service.js";

function fixture() {
  const run = {
    id: "run-new",
    objectId: "object",
    processId: "process",
    inputManifestHash: "manifest",
    version: 2,
    process: { version: 2 },
  };
  const snapshot = {
    id: "snapshot",
    runId: run.id,
    resolvedInputHash: "selection-new",
    snapshot: { schema_version: 1, documents: [], contexts: [], blockers: [] },
  };
  const pack = {
    id: "package",
    objectId: "object",
    version: 3,
    confirmedBy: "inspector",
    frameworkSetId: "framework",
    frameworkSet: { version: 1 },
    requirements: [],
  };
  const tx = {
    run: {
      findUnique: vi.fn().mockResolvedValue(run),
      findFirst: vi.fn().mockResolvedValue(run),
    },
    resolvedInputSnapshot: { findFirst: vi.fn().mockResolvedValue(snapshot) },
    packageVersion: { findFirst: vi.fn().mockResolvedValue(pack) },
    completenessResult: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(({ data }: Prisma.CompletenessResultCreateArgs) => ({
        ...data,
        id: "result",
        createdAt: new Date("2026-09-01T00:00:00Z"),
      })),
    },
    auditEvent: { create: vi.fn().mockResolvedValue({}) },
  };
  const access = {
    lock: vi.fn().mockResolvedValue(undefined),
    requireAccess: vi.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
  };
  const service = new CompletenessService(
    prisma as unknown as PrismaService,
    access as unknown as ObjectAccessService,
    {} as ArtifactStorageService,
  );
  return { service, tx, run, snapshot, pack };
}

describe("completeness Run/selection binding", () => {
  it("does not evaluate a new Run from old classification or old completeness when its snapshot is absent", async () => {
    const { service, tx } = fixture();
    tx.resolvedInputSnapshot.findFirst.mockResolvedValue(null);
    expect(
      await service.evaluateForRun(
        tx as unknown as Prisma.TransactionClient,
        "run-new",
      ),
    ).toBeNull();
    expect(tx.completenessResult.create).not.toHaveBeenCalled();
    expect(
      (await service.getResult("inspector", "object", "run-new")).evaluation,
    ).toBeNull();
    expect(tx.completenessResult.findFirst).not.toHaveBeenCalled();
  });
  it("records both manifest and selection hash with logical document identities", async () => {
    const { service, tx } = fixture();
    const result = await service.evaluateForRun(
      tx as unknown as Prisma.TransactionClient,
      "run-new",
    );
    expect(result).toMatchObject({
      run_id: "run-new",
      resolved_input_hash: "selection-new",
      package_version: 3,
    });
    expect(tx.completenessResult.create).toHaveBeenCalledOnce();
    expect(
      tx.completenessResult.create.mock.calls[0]?.[0].data.inputRefs,
    ).toMatchObject({
      input_manifest_hash: "manifest",
      resolved_input_hash: "selection-new",
      resolved_input_snapshot_id: "snapshot",
      document_ids: [],
    });
  });
  it("idempotently reuses the same Run/selection/package result", async () => {
    const { service, tx } = fixture();
    tx.completenessResult.findFirst.mockResolvedValue({
      id: "existing",
      objectId: "object",
      processId: "process",
      runId: "run-new",
      result: { preserved: true },
      createdAt: new Date("2026-09-01T00:00:00Z"),
    });
    expect(
      (
        await service.evaluateForRun(
          tx as unknown as Prisma.TransactionClient,
          "run-new",
        )
      )?.evaluation,
    ).toEqual({ preserved: true });
    expect(tx.completenessResult.create).not.toHaveBeenCalled();
    expect(tx.completenessResult.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          runId: "run-new",
          packageVersionId: "package",
          inputRefs: { path: ["resolved_input_hash"], equals: "selection-new" },
        },
      }),
    );
  });
  it("historical reads pin the requested Run and its snapshot, never current fallback", async () => {
    const { service, tx, run, snapshot } = fixture();
    run.id = "run-old";
    run.version = 1;
    snapshot.resolvedInputHash = "selection-old";
    await service.getResult("inspector", "object", "run-old");
    expect(tx.resolvedInputSnapshot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          runId: "run-old",
          objectId: "object",
          inputManifestHash: "manifest",
        },
      }),
    );
    expect(tx.completenessResult.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          objectId: "object",
          runId: "run-old",
          inputRefs: { path: ["resolved_input_hash"], equals: "selection-old" },
        },
      }),
    );
    expect(
      await service.evaluateForRun(
        tx as unknown as Prisma.TransactionClient,
        "run-old",
      ),
    ).toBeNull();
  });
  it("does not return another object's result when requested Run is unavailable", async () => {
    const { service, tx } = fixture();
    tx.run.findFirst.mockResolvedValue(null);
    await expect(
      service.getResult("inspector", "object", "unavailable"),
    ).rejects.toThrow("Запуск обработки недоступен");
    expect(tx.completenessResult.findFirst).not.toHaveBeenCalled();
  });
});
