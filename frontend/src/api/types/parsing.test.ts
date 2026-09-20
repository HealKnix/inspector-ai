import { parseResultSchema, parsingFileSchema } from "./parsing";
import {
  createRegionalParseResult,
  parsedFile,
  parseResult,
} from "./parsing-test-fixtures";

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

describe("versioned page regions", () => {
  it.each(["DOCX", "XML"])(
    "accepts newly processed %s with global PDF profile but no region marker",
    (format) => {
      const result = structuredClone(parseResult);
      result.artifact.versions = {
        parser: "synthetic-v1",
        pdf_region_profile: "paddle-regions-v1",
      };
      const page = result.artifact.pages[0]!;
      page.transform = {
        ...page.transform,
        structural_mapping: true,
        layout: "semantic-structure-v1",
        font_sha256: "f".repeat(64),
      };
      page.blocks[0]!.structural_path =
        format === "DOCX" ? "document/paragraph[0]" : "/document/code";
      expect(parseResultSchema.parse(result)).toEqual(result);
    },
  );
  it("still requires the marker on PDF pages and disallows region routing on structural pages", () => {
    const pdf = createRegionalParseResult();
    delete pdf.artifact.region_schema_version;
    delete pdf.artifact.pages[0]!.regions;
    expect(parseResultSchema.safeParse(pdf).success).toBe(false);
    const structural = createRegionalParseResult();
    structural.artifact.pages[0]!.transform.structural_mapping = true;
    expect(parseResultSchema.safeParse(structural).success).toBe(false);
  });
  it("keeps legacy artifacts readable and retains additive region fields", () => {
    expect(parseResultSchema.parse(parseResult)).toEqual(parseResult);
    const result = createRegionalParseResult();
    expect(parseResultSchema.parse(result)).toEqual(result);
  });
  it.each([
    "missing-regions",
    "missing-membership",
    "missing-visibility",
    "duplicate-region",
    "graphic-main",
    "invalid-bbox",
    "wrong-version",
    "ocr-in-skipped-region",
    "ocr-in-native-region",
    "wrong-region-method",
  ])("rejects incomplete regional artifact: %s", (invalid) => {
    const result = createRegionalParseResult();
    const page = result.artifact.pages[0]!;
    if (invalid === "missing-regions") delete page.regions;
    if (invalid === "missing-membership") page.blocks[0]!.region_id = "absent";
    if (invalid === "missing-visibility")
      delete page.blocks[0]!.include_in_main;
    if (invalid === "duplicate-region") page.regions!.push(page.regions![0]!);
    if (invalid === "graphic-main") page.blocks[1]!.include_in_main = true;
    if (invalid === "invalid-bbox") page.regions![0]!.bbox = [0, 0, 0, 0];
    if (invalid === "wrong-version")
      delete result.artifact.versions.pdf_region_profile;
    if (invalid === "ocr-in-skipped-region") page.blocks[1]!.source = "ocr";
    if (invalid === "ocr-in-native-region") page.blocks[0]!.source = "ocr";
    if (invalid === "wrong-region-method") page.regions![1]!.method = "ocr";
    expect(parseResultSchema.safeParse(result).success).toBe(false);
  });
});
