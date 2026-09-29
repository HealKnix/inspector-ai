import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SectionAnalysisError } from "../src/modules/extraction/section-contract.js";
import type { SectionIndexCacheEntry } from "../src/modules/extraction/section-engine.js";
import { identificationJson } from "../src/modules/identification/identification-state.js";
import {
  createSectionFixture,
  syntheticSectionOutput,
  type SectionFixture,
} from "./helpers/section-analysis-fixture.js";

const digest = (input: string) =>
  createHash("sha256").update(input).digest("hex");
const admit = (runId: string, codes?: string[]) => ({
  request_id: randomUUID(),
  expected_run_id: runId,
  ...(codes ? { parameter_codes: codes } : {}),
});

/** Manual release latch for deterministic executor-blocking races. */
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((done) => {
    release = done;
  });
  return { promise, release };
}
async function waitFor(condition: () => boolean) {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting");
    await new Promise((done) => setTimeout(done, 25));
  }
}

/** Outbox rows accumulate per fixture DB; count only events for one task. */
async function succeededEvents(fixture: SectionFixture, taskId: string) {
  const events = await fixture.prisma.outbox.findMany({
    where: { eventType: "section_analysis.succeeded" },
  });
  return events.filter(
    (event) => (event.payload as { task_id?: unknown }).task_id === taskId,
  );
}

describe("section analysis lifecycle", () => {
  let fixture: SectionFixture;
  beforeAll(async () => {
    fixture = await createSectionFixture();
  });
  afterAll(() => fixture.close());
  beforeEach(() => fixture.resetExecutor());

  async function ready() {
    const source = await fixture.seed();
    await fixture.identify(source);
    const matrix = await fixture.seedMatrix(["P001", "P002", "P003"]);
    return { ...source, matrix };
  }

  it("boots the API module against the migrated schema", async () => {
    const source = await fixture.seed();
    const response = await fixture.getSection(source.objectId, source.runId);
    expect(response.status).toBe(200);
    expect(response.body.schema_version).toBe(1);
    expect(response.body.enabled).toBe(true);
    expect(response.body.run_id).toBe(source.runId);
    expect(response.body.task).toBeNull();
    expect(response.body.results).toBeNull();
    // New tables exist on the deployed migration.
    await expect(
      fixture.prisma.sectionIndexCache.count(),
    ).resolves.toBeGreaterThanOrEqual(0);
    await expect(
      fixture.prisma.sectionAnalysisReceipt.count(),
    ).resolves.toBeGreaterThanOrEqual(0);
  });

  it("enforces authentication and object access on both routes", async () => {
    const source = await ready();
    const url = `/api/v1/objects/${source.objectId}/section-analysis`;
    const anonymous = await fixture.postSection(
      source.objectId,
      admit(source.runId),
      { id: "", token: "" },
    );
    expect(anonymous.status).toBe(401);
    const getAnonymous = await fixture.getSection(
      source.objectId,
      source.runId,
      { id: "", token: "" },
    );
    expect(getAnonymous.status).toBe(401);
    expect(
      (
        await fixture.getSection(
          source.objectId,
          source.runId,
          fixture.outsider,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await fixture.postSection(
          source.objectId,
          admit(source.runId),
          fixture.outsider,
        )
      ).status,
    ).toBe(403);
    // A run of another object is never admitted through this object.
    const other = await fixture.seed();
    expect(
      (await fixture.postSection(source.objectId, admit(other.runId))).status,
    ).toBe(404);
    void url;
  });

  it("validates the admission body", async () => {
    const source = await ready();
    const post = (body: unknown) => fixture.postSection(source.objectId, body);
    expect((await post({})).status).toBe(400);
    expect(
      (await post({ request_id: "nope", expected_run_id: source.runId }))
        .status,
    ).toBe(400);
    expect(
      (
        await post({
          ...admit(source.runId),
          parameter_codes: ["P001", "P001"],
        })
      ).status,
    ).toBe(400);
    expect(
      (await post({ ...admit(source.runId), parameter_codes: [] })).status,
    ).toBe(400);
    expect(
      (
        await post({
          ...admit(source.runId),
          parameter_codes: ["P001", "N0T-A-CODE"],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post({
          ...admit(source.runId),
          parameter_codes: Array.from(
            { length: 133 },
            (_, i) => `P${String(i + 1).padStart(3, "0")}`,
          ),
        })
      ).status,
    ).toBe(400);
    expect((await post({ ...admit(source.runId), extra: true })).status).toBe(
      400,
    );
    // Unknown but well-formed matrix code is rejected against pinned rows.
    expect(
      (
        await post({
          request_id: randomUUID(),
          expected_run_id: source.runId,
          parameter_codes: ["P099"],
        })
      ).status,
    ).toBe(400);
    // A different run_id makes the receipt body distinct: unknown code here.
    expect((await post(admit(randomUUID()))).status).toBe(404);
  });

  it("refuses admission when disabled, stale or not resolved", async () => {
    const source = await ready();
    fixture.executor.enabled = false;
    expect(
      (await fixture.postSection(source.objectId, admit(source.runId))).status,
    ).toBe(409);
    fixture.executor.enabled = true;
    // A superseded (non-current) run cannot be admitted.
    await fixture.prisma.process.update({
      where: { id: source.processId },
      data: { version: 2 },
    });
    expect(
      (await fixture.postSection(source.objectId, admit(source.runId))).status,
    ).toBe(409);
    await fixture.prisma.process.update({
      where: { id: source.processId },
      data: { version: 1 },
    });
    // Without identification the snapshot is not published yet.
    const raw = await fixture.seed();
    await fixture.seedMatrix(["P004"]);
    expect(
      (await fixture.postSection(raw.objectId, admit(raw.runId))).status,
    ).toBe(409);
  });

  it("admits, persists and executes a default full-matrix task", async () => {
    const source = await ready();
    const request = admit(source.runId);
    const admitted = await fixture.postSection(source.objectId, request);
    expect(admitted.status).toBe(202);
    expect(admitted.body.request_id).toBe(request.request_id);
    const taskId = admitted.body.task.id;
    expect(admitted.body.task.state).toBe("queued");
    expect(admitted.body.task.parameter_codes).toEqual([
      "P001",
      "P002",
      "P003",
    ]);
    const task = await fixture.prisma.sectionAnalysisTask.findUniqueOrThrow({
      where: { id: taskId },
    });
    expect(task.fingerprint).toHaveLength(64);
    expect(task.matrixImportId).toBe(source.matrix.id);
    expect(task.attempts).toBe(0);
    // Dispatch is durable through the existing outbox, not a direct publish.
    const events = await fixture.prisma.outbox.findMany({
      where: { eventType: "section_analysis.requested" },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      schema_version: 1,
      event_type: "section_analysis.requested",
      task_id: taskId,
    });
    const audits = await fixture.prisma.auditEvent.findMany({
      where: { action: "section_analysis.requested" },
    });
    expect(audits).toHaveLength(1);

    const running = await fixture.getSection(source.objectId, source.runId);
    expect(running.body.active).toBe(true);
    expect(running.body.task?.id).toBe(taskId);
    expect(running.body.results).toBeNull();

    await fixture.sectionJobs.execute(taskId);
    expect(fixture.executor.calls).toHaveLength(1);
    const done = await fixture.prisma.sectionAnalysisTask.findUniqueOrThrow({
      where: { id: taskId },
    });
    expect(done.state).toBe("succeeded");
    expect(done.result).toMatchObject({ schema_version: 1 });
    expect(done.leaseToken).toBeNull();
    const finished = await fixture.getSection(source.objectId, source.runId);
    expect(finished.body.current).toBe(true);
    expect(finished.body.active).toBe(false);
    expect(finished.body.task?.stale).toBe(false);
    expect(finished.body.results).toMatchObject({
      schema_version: 1,
      engine: "synthetic-section-engine-v1",
    });
    expect(await succeededEvents(fixture, taskId)).toHaveLength(1);
    // Duplicate delivery after success is a no-op, not a second execution.
    await fixture.sectionJobs.execute(taskId);
    expect(fixture.executor.calls).toHaveLength(1);
  });

  it("replays a request idempotently and rejects a changed body", async () => {
    const source = await ready();
    const request = admit(source.runId, ["P001"]);
    const first = await fixture.postSection(source.objectId, request);
    const second = await fixture.postSection(source.objectId, request);
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.body.task.id).toBe(first.body.task.id);
    expect(
      await fixture.prisma.sectionAnalysisReceipt.count({
        where: { runId: source.runId },
      }),
    ).toBe(1);
    expect(
      await fixture.prisma.sectionAnalysisTask.count({
        where: { runId: source.runId },
      }),
    ).toBe(1);
    const changed = await fixture.postSection(source.objectId, {
      ...request,
      parameter_codes: ["P002"],
    });
    expect(changed.status).toBe(409);
  });

  it("selects the latest NEW admission; replay never re-selects (A-B-A-B)", async () => {
    const source = await ready();
    // Subset A admitted first.
    const reqA = admit(source.runId, ["P001"]);
    const postA = await fixture.postSection(source.objectId, reqA);
    const taskA = postA.body.task.id;
    // Subset B becomes the current basis.
    const reqB = admit(source.runId, ["P002"]);
    const postB = await fixture.postSection(source.objectId, reqB);
    const taskB = postB.body.task.id;
    expect(taskB).not.toBe(taskA);
    let status = await fixture.getSection(source.objectId, source.runId);
    expect(status.body.task?.id).toBe(taskB);
    // A NEW request for subset A re-selects the cached A task — no new task.
    const reqA2 = admit(source.runId, ["P001"]);
    const postA2 = await fixture.postSection(source.objectId, reqA2);
    expect(postA2.body.task.id).toBe(taskA);
    expect(
      await fixture.prisma.sectionAnalysisTask.count({
        where: { runId: source.runId },
      }),
    ).toBe(2);
    status = await fixture.getSection(source.objectId, source.runId);
    expect(status.body.task?.id).toBe(taskA);
    // Replaying the OLD B request returns its receipt but keeps A selected.
    const replayB = await fixture.postSection(source.objectId, reqB);
    expect(replayB.status).toBe(202);
    expect(replayB.body.task.id).toBe(taskB);
    status = await fixture.getSection(source.objectId, source.runId);
    expect(status.body.task?.id).toBe(taskA);
    // Receipt ordering is explicit: B's receipt precedes the new A receipt.
    const receipts = await fixture.prisma.sectionAnalysisReceipt.findMany({
      where: { runId: source.runId },
      orderBy: { seq: "asc" },
    });
    expect(receipts.map((receipt) => receipt.taskId)).toEqual([
      taskA,
      taskB,
      taskA,
    ]);
  });

  it("reuses a completed semantic task without executor calls", async () => {
    const source = await ready();
    const request = admit(source.runId, ["P001"]);
    const first = await fixture.postSection(source.objectId, request);
    await fixture.sectionJobs.execute(first.body.task.id);
    expect(fixture.executor.calls).toHaveLength(1);
    const again = await fixture.postSection(
      source.objectId,
      admit(source.runId, ["P001"]),
    );
    expect(again.body.task.id).toBe(first.body.task.id);
    expect(again.body.task.state).toBe("succeeded");
    expect(fixture.executor.calls).toHaveLength(1);
    expect(
      await fixture.prisma.sectionAnalysisTask.count({
        where: { runId: source.runId },
      }),
    ).toBe(1);
  });

  it("creates a new cycle when the previous semantic task failed", async () => {
    const source = await ready();
    fixture.executor.impl = () =>
      Promise.reject(new SectionAnalysisError("section_llm_http_401", false));
    const first = await fixture.postSection(
      source.objectId,
      admit(source.runId),
    );
    await fixture.sectionJobs.execute(first.body.task.id);
    expect(
      (
        await fixture.prisma.sectionAnalysisTask.findUniqueOrThrow({
          where: { id: first.body.task.id },
        })
      ).state,
    ).toBe("failed");
    fixture.executor.impl = () => Promise.resolve(syntheticSectionOutput);
    const second = await fixture.postSection(
      source.objectId,
      admit(source.runId),
    );
    expect(second.body.task.id).not.toBe(first.body.task.id);
    expect(second.body.task.cycle).toBe(2);
  });

  it("retries retryable executor failures with a bounded budget", async () => {
    const source = await ready();
    fixture.executor.impl = () =>
      Promise.reject(new SectionAnalysisError("section_llm_timeout", true));
    const admitted = await fixture.postSection(
      source.objectId,
      admit(source.runId),
    );
    const taskId = admitted.body.task.id;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await fixture.prisma.sectionAnalysisTask.update({
        where: { id: taskId },
        data: { availableAt: new Date(0) },
      });
      await fixture.sectionJobs.execute(taskId);
      const task = await fixture.prisma.sectionAnalysisTask.findUniqueOrThrow({
        where: { id: taskId },
      });
      if (attempt < 3) {
        expect(task.state).toBe("queued");
        expect(task.errorCode).toBe("section_llm_timeout");
        expect(task.attempts).toBe(attempt);
      } else {
        expect(task.state).toBe("failed");
        expect(task.errorCode).toBe("section_llm_timeout");
        expect(task.attempts).toBe(3);
      }
    }
    // A non-retryable provider error fails immediately on the first attempt.
    fixture.executor.impl = () =>
      Promise.reject(new SectionAnalysisError("section_llm_http_401", false));
    const second = await fixture.postSection(
      source.objectId,
      admit(source.runId, ["P002"]),
    );
    await fixture.sectionJobs.execute(second.body.task.id);
    const failed = await fixture.prisma.sectionAnalysisTask.findUniqueOrThrow({
      where: { id: second.body.task.id },
    });
    expect(failed.state).toBe("failed");
    expect(failed.errorCode).toBe("section_llm_http_401");
    expect(failed.attempts).toBe(1);
  });

  it("maps engine-returned failures instead of publishing success", async () => {
    const source = await ready();
    // Retryable provider failure inside the output: bounded retry, output kept.
    fixture.executor.impl = () =>
      Promise.resolve({
        ...syntheticSectionOutput,
        failures: [
          {
            stage: "analysis",
            context_id: "ctx-1",
            code: "section_llm_http_429",
            retryable: true,
          },
        ],
      });
    const first = await fixture.postSection(
      source.objectId,
      admit(source.runId, ["P001"]),
    );
    await fixture.sectionJobs.execute(first.body.task.id);
    const retried = await fixture.prisma.sectionAnalysisTask.findUniqueOrThrow({
      where: { id: first.body.task.id },
    });
    expect(retried.state).toBe("queued");
    expect(retried.errorCode).toBe("section_llm_http_429");
    // Terminal provider/contract failure: failed, never succeeded.
    fixture.executor.impl = () =>
      Promise.resolve({
        ...syntheticSectionOutput,
        failures: [
          {
            stage: "analysis",
            context_id: "ctx-1",
            code: "section_llm_http_401",
            retryable: false,
          },
        ],
      });
    const second = await fixture.postSection(
      source.objectId,
      admit(source.runId, ["P002"]),
    );
    await fixture.sectionJobs.execute(second.body.task.id);
    const terminal = await fixture.prisma.sectionAnalysisTask.findUniqueOrThrow(
      { where: { id: second.body.task.id } },
    );
    expect(terminal.state).toBe("failed");
    expect(terminal.errorCode).toBe("section_llm_http_401");
    expect(terminal.result).toMatchObject({ schema_version: 1 });
    const failedEvents = await fixture.prisma.outbox.findMany({
      where: { eventType: "section_analysis.failed" },
    });
    expect(failedEvents.length).toBeGreaterThanOrEqual(1);
    // Legitimate call-budget exhaustion is a domain outcome: still succeeded.
    fixture.executor.impl = () =>
      Promise.resolve({
        ...syntheticSectionOutput,
        failures: [
          {
            stage: "discovery",
            context_id: "ctx-1",
            code: "section_call_budget_exhausted",
            retryable: false,
          },
        ],
      });
    const third = await fixture.postSection(
      source.objectId,
      admit(source.runId, ["P003"]),
    );
    await fixture.sectionJobs.execute(third.body.task.id);
    const bounded = await fixture.prisma.sectionAnalysisTask.findUniqueOrThrow({
      where: { id: third.body.task.id },
    });
    expect(bounded.state).toBe("succeeded");
  });

  it("never publishes success after cancellation", async () => {
    const source = await ready();
    const admitted = await fixture.postSection(
      source.objectId,
      admit(source.runId),
    );
    const taskId = admitted.body.task.id;
    const stop = new AbortController();
    // The executor returns cleanly while the worker signal is already aborted:
    // the post-completion fence must still route this into a retry.
    fixture.executor.impl = () => {
      stop.abort();
      return Promise.resolve(syntheticSectionOutput);
    };
    await fixture.sectionJobs.execute(taskId, stop.signal);
    const interrupted =
      await fixture.prisma.sectionAnalysisTask.findUniqueOrThrow({
        where: { id: taskId },
      });
    expect(interrupted.state).toBe("queued");
    expect(interrupted.errorCode).toBe("section_interrupted");
    // An already-aborted delivery does not even claim the task.
    const second = await fixture.postSection(
      source.objectId,
      admit(source.runId, ["P002"]),
    );
    await fixture.sectionJobs.execute(second.body.task.id, AbortSignal.abort());
    expect(
      (
        await fixture.prisma.sectionAnalysisTask.findUniqueOrThrow({
          where: { id: second.body.task.id },
        })
      ).state,
    ).toBe("queued");
    // Only the interrupted delivery above reached the executor.
    expect(fixture.executor.calls).toHaveLength(1);
  });

  it("fences finalized and superseded runs at claim and publication", async () => {
    const source = await ready();
    const admitted = await fixture.postSection(
      source.objectId,
      admit(source.runId),
    );
    const taskId = admitted.body.task.id;
    await fixture.prisma.process.update({
      where: { id: source.processId },
      data: { status: "FINALIZED" },
    });
    await fixture.sectionJobs.execute(taskId);
    const fenced = await fixture.prisma.sectionAnalysisTask.findUniqueOrThrow({
      where: { id: taskId },
    });
    expect(fenced.state).toBe("failed");
    expect(fenced.errorCode).toBe("section_superseded");
    expect(fenced.result).toBeNull();
    expect(fixture.executor.calls).toHaveLength(0);
    const status = await fixture.getSection(source.objectId, source.runId);
    expect(status.body.results).toBeNull();
  });

  it("suppresses stale results while keeping task metadata readable", async () => {
    const source = await ready();
    const admitted = await fixture.postSection(
      source.objectId,
      admit(source.runId),
    );
    await fixture.sectionJobs.execute(admitted.body.task.id);
    let status = await fixture.getSection(source.objectId, source.runId);
    expect(status.body.task?.stale).toBe(false);
    expect(status.body.results).not.toBeNull();
    // A newer resolved snapshot makes the completed basis stale.
    const snapshot =
      await fixture.prisma.resolvedInputSnapshot.findFirstOrThrow({
        where: { runId: source.runId },
        orderBy: { version: "desc" },
      });
    await fixture.prisma.resolvedInputSnapshot.create({
      data: {
        version: snapshot.version + 1,
        objectId: snapshot.objectId,
        processId: snapshot.processId,
        runId: snapshot.runId,
        inputManifestHash: snapshot.inputManifestHash,
        resolvedInputHash: digest(`rotated:${snapshot.resolvedInputHash}`),
        sourceFingerprint: digest(`fingerprint:${snapshot.sourceFingerprint}`),
        snapshot: identificationJson(snapshot.snapshot),
      },
    });
    status = await fixture.getSection(source.objectId, source.runId);
    expect(status.body.task).not.toBeNull();
    expect(status.body.task?.stale).toBe(true);
    expect(status.body.results).toBeNull();
  });

  it("recovers expired leases but never a live heartbeat lease", async () => {
    const source = await ready();
    const admitted = await fixture.postSection(
      source.objectId,
      admit(source.runId),
    );
    const taskId = admitted.body.task.id;
    const token = randomUUID();
    await fixture.prisma.sectionAnalysisTask.update({
      where: { id: taskId },
      data: {
        state: "processing",
        attempts: 1,
        leaseToken: token,
        leaseUntil: new Date(Date.now() - 1000),
      },
    });
    await fixture.sectionJobs.recover();
    const recovered =
      await fixture.prisma.sectionAnalysisTask.findUniqueOrThrow({
        where: { id: taskId },
      });
    expect(recovered.state).toBe("queued");
    expect(recovered.errorCode).toBe("section_lease_expired");
    expect(recovered.leaseToken).toBeNull();
    // A live heartbeat lease (future expiry) is never selected for expiry
    // recovery; the under-lock recheck additionally guards the select->lock
    // race, verified by review probes rather than a timing-dependent test.
    await fixture.prisma.sectionAnalysisTask.update({
      where: { id: taskId },
      data: {
        state: "processing",
        leaseToken: token,
        leaseUntil: new Date(Date.now() + 60_000),
      },
    });
    await fixture.sectionJobs.recover();
    const live = await fixture.prisma.sectionAnalysisTask.findUniqueOrThrow({
      where: { id: taskId },
    });
    expect(live.state).toBe("processing");
    expect(live.leaseToken).toBe(token);
  });

  it("persists semantic index entries without run binding", async () => {
    const source = await ready();
    const key = "f".repeat(64);
    const entry: SectionIndexCacheEntry = {
      sections: [
        {
          section_id: "sec-1",
          source_ref: "actual:0",
          title: "Синтетический раздел",
          start_block_id: "p1:b0",
          end_block_id: "p1:b0",
          parameter_codes: ["P001"],
        },
      ],
      missing_context: [],
    };
    fixture.executor.impl = async (work) => {
      await work.index.set(key, entry);
      expect(await work.index.get(key)).toMatchObject({
        sections: [{ section_id: "sec-1" }],
      });
      return syntheticSectionOutput;
    };
    const admitted = await fixture.postSection(
      source.objectId,
      admit(source.runId),
    );
    await fixture.sectionJobs.execute(admitted.body.task.id);
    const cached = await fixture.prisma.sectionIndexCache.findUnique({
      where: { fingerprint: key },
    });
    expect(cached?.boundaries).toMatchObject({
      sections: [{ section_id: "sec-1" }],
    });
  });

  it("serializes simultaneous duplicate deliveries into one execution", async () => {
    const source = await ready();
    const admitted = await fixture.postSection(
      source.objectId,
      admit(source.runId),
    );
    const taskId = admitted.body.task.id;
    await Promise.all([
      fixture.sectionJobs.execute(taskId),
      fixture.sectionJobs.execute(taskId),
    ]);
    expect(fixture.executor.calls).toHaveLength(1);
    const task = await fixture.prisma.sectionAnalysisTask.findUniqueOrThrow({
      where: { id: taskId },
    });
    expect(task.state).toBe("succeeded");
    expect(task.attempts).toBe(1);
    expect(await succeededEvents(fixture, taskId)).toHaveLength(1);
  });

  it("fences publication when the process finalizes mid-execution", async () => {
    const source = await ready();
    const admitted = await fixture.postSection(
      source.objectId,
      admit(source.runId),
    );
    const taskId = admitted.body.task.id;
    const hold = gate();
    fixture.executor.impl = async () => {
      await hold.promise;
      return syntheticSectionOutput;
    };
    const execution = fixture.sectionJobs.execute(taskId);
    await waitFor(() => fixture.executor.calls.length === 1);
    await fixture.prisma.process.update({
      where: { id: source.processId },
      data: { status: "FINALIZED" },
    });
    hold.release();
    await execution;
    const task = await fixture.prisma.sectionAnalysisTask.findUniqueOrThrow({
      where: { id: taskId },
    });
    expect(task.state).toBe("failed");
    expect(task.errorCode).toBe("section_superseded");
    expect(task.result).toBeNull();
    expect(await succeededEvents(fixture, taskId)).toHaveLength(0);
  });

  it("keeps the replacement owner when a stale executor finishes late", async () => {
    const source = await ready();
    const admitted = await fixture.postSection(
      source.objectId,
      admit(source.runId),
    );
    const taskId = admitted.body.task.id;
    const hold = gate();
    fixture.executor.impl = async () => {
      await hold.promise;
      return {
        ...syntheticSectionOutput,
        engine: "stale-owner-result",
      };
    };
    const execution = fixture.sectionJobs.execute(taskId);
    await waitFor(() => fixture.executor.calls.length === 1);
    // Its lease expires while blocked; recovery requeues, and the next
    // delivery claims the row with a new lease token.
    await fixture.prisma.sectionAnalysisTask.update({
      where: { id: taskId },
      data: { leaseUntil: new Date(Date.now() - 1000) },
    });
    await fixture.sectionJobs.recover();
    fixture.executor.impl = () =>
      Promise.resolve({
        ...syntheticSectionOutput,
        engine: "replacement-owner-result",
      });
    await fixture.prisma.sectionAnalysisTask.update({
      where: { id: taskId },
      data: { availableAt: new Date(0) },
    });
    await fixture.sectionJobs.execute(taskId);
    hold.release();
    await execution;
    const task = await fixture.prisma.sectionAnalysisTask.findUniqueOrThrow({
      where: { id: taskId },
    });
    expect(task.state).toBe("succeeded");
    expect(task.attempts).toBe(2);
    expect(task.result).toMatchObject({
      engine: "replacement-owner-result",
    });
    expect(await succeededEvents(fixture, taskId)).toHaveLength(1);
  });

  it("pins the release catalog import over a newer import", async () => {
    const older = await fixture.seedMatrix(["P001", "P002", "P003"]);
    const release = await fixture.prisma.ruleSetRelease.create({
      data: {
        manifest: {
          schema_version: 1,
          mode: "legacy_capture",
          catalog: {
            import_id: older.id,
            catalog_sha256: older.sourceSha256,
            origin_sha256: older.originSha256,
            row_count: 3,
          },
          engines: [],
          extraction_fingerprint: "0".repeat(64),
          entries: [],
          omitted_parameter_codes: [],
        },
        manifestHash: digest(`release:${randomUUID()}`),
        createdBy: fixture.inspector.id,
      },
    });
    const source = await fixture.seed([{}], release.id);
    await fixture.identify(source);
    const newer = await fixture.seedMatrix(["P004"]);
    const admitted = await fixture.postSection(
      source.objectId,
      admit(source.runId),
    );
    expect(admitted.status).toBe(202);
    const task = await fixture.prisma.sectionAnalysisTask.findUniqueOrThrow({
      where: { id: admitted.body.task.id },
    });
    expect(task.matrixImportId).toBe(older.id);
    expect(task.matrixImportId).not.toBe(newer.id);
  });
});
