import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parserProgress, type ParserProgress } from "./parsing-progress.js";

const requestId = randomUUID();
const fingerprint = "a".repeat(64);
const progress: ParserProgress = {
  request_id: requestId,
  pipeline_fingerprint: fingerprint,
  stage: "resuming",
  pages_completed: 6,
  pages_total: 20,
  checkpoint_validated: true,
  checkpoint_pages: 6,
  current_page: 2, // Holes mean the physical page need not follow the count.
};

describe("fenced parser progress contract", () => {
  it("accepts verified checkpoint holes without conflating counts and page numbers", () => {
    expect(parserProgress(progress, requestId, fingerprint)).toEqual(progress);
  });

  it("accepts an unverified start and structured formats without claiming checkpoints", () => {
    for (const checkpoint_validated of [false, true]) {
      const value = {
        ...progress,
        stage: checkpoint_validated ? "rendering" : "checkpoint_verifying",
        pages_completed: 0,
        pages_total: null,
        current_page: null,
        checkpoint_pages: null,
        checkpoint_validated,
      };
      expect(parserProgress(value, requestId, fingerprint)).toEqual(value);
    }
  });

  it.each([
    ["another request", { request_id: randomUUID() }],
    ["another pipeline", { pipeline_fingerprint: "b".repeat(64) }],
    ["unknown stage", { stage: "synthetic_unknown" }],
    ["fractional count", { pages_completed: 1.5 }],
    ["invalid total", { pages_total: 5 }],
    ["unbounded total", { pages_total: 10_001 }],
    ["unverified checkpoint count", { checkpoint_validated: false }],
    ["invalid checkpoint count", { checkpoint_pages: 7 }],
    ["false validated starting phase", { stage: "starting" }],
    ["page zero", { current_page: 0 }],
    ["page outside document", { current_page: 21 }],
  ])("ignores %s", (_label, patch) => {
    expect(
      parserProgress({ ...progress, ...patch }, requestId, fingerprint),
    ).toBeNull();
  });

  it("does not infer checkpoint validity or request ownership from legacy progress", () => {
    expect(
      parserProgress(
        { pages_completed: 5, pages_total: 20, stage: "extracting" },
        requestId,
        fingerprint,
      ),
    ).toBeNull();
  });
});
