import { expect, it } from "vitest";
import { ParsingDeliveryScope } from "./parsing-delivery-scope.js";

it("cancels an old broker's parse and waits for durable cleanup before reconnection", async () => {
  const shutdown = new AbortController();
  const scope = new ParsingDeliveryScope(shutdown.signal);
  let release!: () => void;
  const cleanup = new Promise<void>((resolve) => {
    release = resolve;
  });
  let cancelled = false;
  let concurrent = 0;
  let maxConcurrent = 0;
  const old = scope.run(async (signal) => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await new Promise<void>((resolve) =>
      signal.addEventListener(
        "abort",
        () => {
          cancelled = true;
          resolve();
        },
        { once: true },
      ),
    );
    await cleanup;
    concurrent--;
  });
  let drained = false;
  const drain = scope.drain().then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(cancelled).toBe(true);
  expect(drained).toBe(false);
  let invalidNewCall = false;
  await scope.run(() => {
    invalidNewCall = true;
    return Promise.resolve();
  });
  expect(invalidNewCall).toBe(false);
  release();
  await drain;
  await old;
  const replacement = new ParsingDeliveryScope(shutdown.signal);
  await replacement.run(() => {
    concurrent++;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    concurrent--;
    return Promise.resolve();
  });
  expect(maxConcurrent).toBe(1);
});

it("propagates shutdown into the active channel scope", async () => {
  const shutdown = new AbortController();
  const scope = new ParsingDeliveryScope(shutdown.signal);
  shutdown.abort();
  expect(scope.signal.aborted).toBe(true);
  await scope.drain();
});
