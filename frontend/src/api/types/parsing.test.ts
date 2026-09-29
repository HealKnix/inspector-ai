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
  function modern() {
    const result = createRegionalParseResult();
    result.artifact.text_provenance_schema_version = 1;
    result.artifact.versions = {
      ...result.artifact.versions,
      pdf_region_profile: "paddle-regions-v2",
      text_provenance: "par-text-provenance-v1",
    };
    for (const block of result.artifact.pages[0]!.blocks) {
      block.native_valid = true;
      if (block.raw_text.length)
        block.provenance = {
          schema_version: 1,
          status: "selected",
          method: "native",
          fragments: [
            {
              source: "native",
              raw_text: block.raw_text,
              bbox: [...block.bbox],
              native_valid: true,
              role: "selected",
            },
          ],
          reasons: [],
        };
    }
    const block = result.artifact.pages[0]!.blocks[0]!;
    block.provenance = {
      schema_version: 1,
      status: "selected",
      method: "native",
      fragments: [
        {
          source: "native",
          raw_text: block.raw_text,
          bbox: [...block.bbox],
          native_valid: true,
          role: "selected",
        },
      ],
      reasons: [],
    };
    block.table_link = {
      schema_version: 1,
      status: "associated",
      table_id: "table-1",
      rows: [0],
      columns: [0],
      reasons: [],
    };
    return result;
  }
  it("retains provenance, native validity and table associations through Zod", () => {
    const result = modern();
    expect(parseResultSchema.parse(result)).toEqual(result);
    const block = result.artifact.pages[0]!.blocks[0]!;
    block.include_in_main = false;
    block.provenance!.status = "ambiguous";
    block.provenance!.reasons = ["TEXT_CONFLICT"];
    block.provenance!.method = "hybrid";
    block.provenance!.fragments.push({
      source: "ocr",
      raw_text: "Иной текст",
      bbox: [...block.bbox],
      native_valid: null,
      role: "alternative",
    });
    block.table_link = {
      ...block.table_link!,
      status: "ambiguous",
      table_id: null,
      reasons: ["TABLE_LINK_TARGET_UNRESOLVED"],
    };
    expect(parseResultSchema.parse(result)).toEqual(result);
    expect(
      parseResultSchema.parse(createRegionalParseResult()).artifact.pages[0]!
        .blocks[0]!.native_valid,
    ).toBeUndefined();
  });
  it.each([
    "marker",
    "native-valid",
    "wrong-fragment-validity",
    "unhidden-ambiguity",
    "bad-table",
    "bad-row",
    "duplicate-columns",
    "empty-columns",
    "associated-null",
    "unknown-field",
    "missing-provenance",
    "wrong-method",
  ])("rejects malformed provenance %s", (invalid) => {
    const result = modern();
    const block = result.artifact.pages[0]!.blocks[0]!;
    if (invalid === "marker")
      delete result.artifact.text_provenance_schema_version;
    if (invalid === "missing-provenance") delete block.provenance;
    if (invalid === "wrong-method") block.provenance!.method = "hybrid";
    if (invalid === "native-valid") delete block.native_valid;
    if (invalid === "wrong-fragment-validity")
      block.provenance!.fragments[0]!.native_valid = null;
    if (invalid === "unhidden-ambiguity") {
      block.provenance!.status = "ambiguous";
      block.provenance!.reasons = ["TEXT_CONFLICT"];
    }
    if (invalid === "bad-table")
      block.table_link!.table_id = "another-page-table";
    if (invalid === "bad-row") block.table_link!.rows = [9];
    if (invalid === "duplicate-columns") block.table_link!.columns = [0, 0];
    if (invalid === "empty-columns") block.table_link!.columns = [];
    if (invalid === "associated-null") block.table_link!.table_id = null;
    if (invalid === "unknown-field")
      Object.assign(block.provenance!, { guessed: true });
    expect(parseResultSchema.safeParse(result).success).toBe(false);
  });
  it.each(["DOCX", "XML"])(
    "accepts newly processed %s with global PDF profile but no region marker",
    (format) => {
      const result = structuredClone(parseResult);
      result.artifact.versions = {
        parser: "par-local-2",
        pdf_region_profile: "paddle-regions-v2",
        text_provenance: "par-text-provenance-v1",
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
