import { describe, expect, it, vi } from "vitest";
import type { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import type { ObjectAccessService } from "../objects/object-access.service.js";
import type { ExtractionJobsService } from "./extraction-jobs.service.js";
import { ExtractionService } from "./extraction.service.js";

function fixture() {
  const run = {
    id: "run-old",
    objectId: "object",
    processId: "process-old",
    version: 1,
    inputManifestHash: "manifest-old",
    process: { version: 2 },
  };
  const selection = {
    id: "snapshot-old",
    runId: "run-old",
    resolvedInputHash: "selection-old",
  };
  const tx = {
    process: {
      findFirst: vi.fn().mockResolvedValue({ id: "process-new", version: 2 }),
    },
    run: { findFirst: vi.fn().mockResolvedValue(run) },
    resolvedInputSnapshot: { findFirst: vi.fn().mockResolvedValue(selection) },
    evidenceFragment: { findMany: vi.fn().mockResolvedValue([]) },
    $queryRaw: vi.fn().mockResolvedValue([]),
  };
  const access = {
    lock: vi.fn().mockResolvedValue(undefined),
    requireAccess: vi.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
  };
  const jobs = { approvedRules: vi.fn().mockResolvedValue([]) };
  const service = new ExtractionService(
    prisma as unknown as PrismaService,
    access as unknown as ObjectAccessService,
    jobs as unknown as ExtractionJobsService,
  );
  return { service, tx, access, jobs, run, selection };
}

describe("extraction history is scoped to Run and ID snapshot", () => {
  it("reads groups for an explicitly selected historical Run without consulting the current process", async () => {
    const { service, tx } = fixture();
    tx.$queryRaw.mockResolvedValue([{ id: "historical-group" }]);
    expect(
      await service.groups("inspector", "object", "run-old"),
    ).toMatchObject({
      run_id: "run-old",
      resolved_input_hash: "selection-old",
      current: false,
      items: [{ id: "historical-group" }],
    });
    expect(tx.process.findFirst).not.toHaveBeenCalled();
    expect(tx.run.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "run-old", objectId: "object" } }),
    );
    expect(tx.resolvedInputSnapshot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          runId: "run-old",
          objectId: "object",
          inputManifestHash: "manifest-old",
        },
        orderBy: { version: "desc" },
      }),
    );
    const sql = tx.$queryRaw.mock.calls[0]!;
    expect(sql.slice(1)).toEqual(["object", "run-old", "selection-old"]);
    expect((sql[0] as TemplateStringsArray).join(" ")).not.toContain(
      "p.version",
    );
  });
  it("defaults to the newest process's current version", async () => {
    const { service, tx, run } = fixture();
    run.id = "run-new";
    run.version = 2;
    await service.groups("inspector", "object");
    expect(tx.process.findFirst).toHaveBeenCalledWith({
      where: { objectId: "object" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(tx.run.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { processId: "process-new", version: 2, objectId: "object" },
      }),
    );
  });
  it("does not return current data when the requested Run is foreign or unavailable", async () => {
    const { service, tx } = fixture();
    tx.run.findFirst.mockResolvedValue(null);
    await expect(
      service.groups("inspector", "object", "foreign-run"),
    ).rejects.toThrow("Запуск обработки недоступен");
    await expect(
      service.list("inspector", "object", "foreign-run"),
    ).rejects.toThrow("Запуск обработки недоступен");
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(tx.process.findFirst).not.toHaveBeenCalled();
  });
  it("keeps an absent historical snapshot empty rather than borrowing current results", async () => {
    const { service, tx, jobs } = fixture();
    tx.resolvedInputSnapshot.findFirst.mockResolvedValue(null);
    expect(await service.list("inspector", "object", "run-old")).toMatchObject({
      run_id: "run-old",
      resolved_input_hash: null,
      current: false,
      items: [],
      tasks: [],
      active: false,
    });
    expect(
      await service.groups("inspector", "object", "run-old"),
    ).toMatchObject({
      run_id: "run-old",
      resolved_input_hash: null,
      items: [],
    });
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    expect(jobs.approvedRules).not.toHaveBeenCalled();
  });
  it("uses historical task fingerprints and never polls an old Run", async () => {
    const { service, tx, jobs } = fixture();
    tx.$queryRaw
      .mockResolvedValueOnce([{ id: "extraction-old", file_id: "file-old" }])
      .mockResolvedValueOnce([
        { task_id: "task-old", state: "queued", fingerprint: "rules-old" },
      ]);
    tx.evidenceFragment.findMany.mockResolvedValue([
      {
        extractionId: "extraction-old",
        fileId: "file-old",
        artifactId: "artifact-old",
        pageNumber: 2,
        blockId: "block-2",
        quote: "Исторический источник",
        bbox: [0, 0, 1, 1],
        structuralPath: null,
      },
    ]);
    const result = await service.list("inspector", "object", "run-old");
    expect(result).toMatchObject({
      ruleset_fingerprint: "rules-old",
      active: false,
      current: false,
      run_id: "run-old",
      resolved_input_hash: "selection-old",
    });
    expect(result.items[0]!.evidence[0]).toMatchObject({
      artifact_id: "artifact-old",
      page_number: 2,
      quote: "Исторический источник",
    });
    expect(tx.evidenceFragment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { extractionId: { in: ["extraction-old"] } },
      }),
    );
    for (const call of tx.$queryRaw.mock.calls) {
      expect(call.slice(1)).toContain("run-old");
      expect(call.slice(1)).toContain("selection-old");
      expect((call[0] as TemplateStringsArray).join(" ")).toContain(
        "newer.resolved_input_hash",
      );
    }
    expect(jobs.approvedRules).not.toHaveBeenCalled();
  });
  it("checks object access before even resolving a requested Run", async () => {
    const { service, tx, access } = fixture();
    access.requireAccess.mockRejectedValue(new Error("forbidden"));
    await expect(
      service.groups("revoked", "object", "run-old"),
    ).rejects.toThrow("forbidden");
    expect(tx.run.findFirst).not.toHaveBeenCalled();
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});
