import { parsingFileSchema } from "./parsing";
import { parsedFile } from "./parsing-test-fixtures";

describe("parsing progress compatibility", () => {
  it("accepts a legacy file and validates the additive readiness and checkpoint fields", () => {
    expect(parsingFileSchema.parse(parsedFile)).toEqual(parsedFile);
    const file = {
      ...parsedFile,
      phase: "checkpoint_verifying",
      progress_updated_at: "2026-09-18T08:00:00.000Z",
      waiting_reason: null,
      retry_at: null,
      checkpoint_pages: 38,
      checkpoint_validated: false,
      current_page: null,
      previous_attempt_error: "parser_timeout",
      progress_reset_reason: null,
    };
    expect(parsingFileSchema.parse(file)).toEqual(file);
  });
  it.each(["pipeline_version_changed", "saved_pages_unavailable"])(
    "preserves the server explanation for a lower count: %s",
    (reason) => {
      expect(
        parsingFileSchema.parse({
          ...parsedFile,
          progress_reset_reason: reason,
        }).progress_reset_reason,
      ).toBe(reason);
    },
  );
  it.each([
    { progress_updated_at: "yesterday" },
    { retry_at: "soon" },
    { checkpoint_validated: "true" },
    { checkpoint_pages: -1 },
    { current_page: 0 },
    { waiting_reason: "unknown_status" },
    { progress_reset_reason: "unknown_cause" },
  ])(
    "rejects malformed progress rather than presenting fabricated progress: %o",
    (invalid) => {
      expect(
        parsingFileSchema.safeParse({ ...parsedFile, ...invalid }).success,
      ).toBe(false);
    },
  );
});
