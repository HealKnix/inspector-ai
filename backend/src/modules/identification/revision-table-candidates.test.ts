import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type {
  ParseArtifactData,
  ParseBlock,
  ParseRegion,
} from "../parsing/parsing-contract.js";
import { identifyArtifact } from "./identification-engine.js";
import { revisionTableCandidates } from "./revision-table-candidates.js";

// Published, deidentified diagnostic truth. The wrapper adds synthetic v1
// native-valid signals; the separate runtime probe checks actual PAR output.
const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../document-parser/tests/fixtures/native-ocr/revision-native-context.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  native_blocks: ParseBlock[];
  regions: ParseRegion[];
};
function source(): ParseArtifactData {
  return {
    schema_version: 1,
    source_sha256: "a".repeat(64),
    pipeline_fingerprint: "b".repeat(64),
    versions: { parser: "synthetic-wrapper-over-authorised-diagnostic" },
    raw_text: "",
    normalized_text: "",
    quality: "LOW_QUALITY",
    reasons: ["LAYOUT_BOUNDARY_CONFLICT"],
    coverage: { total_pages: 1, readable_pages: 1, unreadable_pages: 0 },
    pages: [
      {
        page_number: 1,
        sheet_label: null,
        width: 1653,
        height: 2339,
        image_key: "synthetic",
        image_sha256: "c".repeat(64),
        quality: "LOW_QUALITY",
        reasons: ["LAYOUT_BOUNDARY_CONFLICT"],
        transform: {},
        regions: structuredClone(fixture.regions),
        blocks: fixture.native_blocks.map((block) => ({
          ...structuredClone(block),
          native_valid: true,
        })),
      },
    ],
  };
}
const identify = (artifact: ParseArtifactData) =>
  identifyArtifact({
    artifact,
    representation: {
      file_id: "00000000-0000-4000-8000-000000000001",
      artifact_id: "00000000-0000-4000-8000-000000000002",
      artifact_sha256: "d".repeat(64),
      source_sha256: artifact.source_sha256,
      format: "PDF",
      page_count: artifact.pages.length,
    },
  });
describe("revision permission candidates", () => {
  it("retains revision 3 and sheets 1/4/8 at their original locators without accepting a replacement", () => {
    const input = source();
    const before = JSON.stringify(input);
    const result = identify(input);
    expect(
      result.candidates
        .filter((item) => item.field === "observed_replaced_sheet")
        .map((item) => [item.raw, item.evidence[0]!.block_id])
        .sort(),
    ).toEqual([
      ["1", "p1-b30"],
      ["4", "p1-b36"],
      ["8", "p1-b40"],
    ]);
    const revision = result.candidates.find(
      (item) => item.field === "revision_label",
    )!;
    expect(revision.raw).toBe("3");
    expect(revision.evidence[0]).toMatchObject({
      block_id: "p1-b29",
      quote: "3",
      bbox: [0.1263574, 0.175509, 0.1346822, 0.1885528],
      parse_context: {
        source: "native",
        native_valid: true,
        include_in_main: false,
        region_method: "skipped",
      },
    });
    expect(revision.evidence[0]?.parse_context?.reasons).toContain(
      "LAYOUT_BOUNDARY_CONFLICT",
    );
    expect(result.candidates.find((item) => item.field === "number")?.raw).toBe(
      "158-26",
    );
    expect(result.fields.revision_label).toBeUndefined();
    expect(result.fields.observed_replaced_sheet).toBeUndefined();
    expect(result.approval.confirmed).toBe(false);
    expect(result.blockers).toContain("unsupported_partial_replacement");
    expect(JSON.stringify(input)).toBe(before);
  });
  it("does not infer replacement from a list of sheets without a replacement note", () => {
    const input = source();
    input.pages[0]!.blocks = input.pages[0]!.blocks.filter(
      (b) => !/Замена листа/u.test(b.raw_text),
    );
    expect(revisionTableCandidates(input.pages[0]!)).toEqual([]);
  });
  it("does not borrow a sheet value from another column or row", () => {
    const input = source();
    input.pages[0]!.blocks.find((b) => b.id === "p1-b30")!.bbox = [
      0.7, 0.175, 0.71, 0.188,
    ];
    input.pages[0]!.blocks.find((b) => b.id === "p1-b36")!.bbox = [
      0.19, 0.8, 0.21, 0.81,
    ];
    expect(
      revisionTableCandidates(input.pages[0]!)
        .filter((c) => c.field === "observed_replaced_sheet")
        .map((c) => c.value.raw_text),
    ).toEqual(["8"]);
  });
  it.each(["legacy", "invalid", "ambiguous", "duplicate"])(
    "excludes %s native text",
    (kind) => {
      const input = source();
      for (const block of input.pages[0]!.blocks) {
        if (kind === "legacy") delete block.native_valid;
        if (kind === "invalid") block.native_valid = false;
        if (kind === "ambiguous" || kind === "duplicate")
          block.provenance = {
            schema_version: 1,
            status: kind === "ambiguous" ? "ambiguous" : "selected",
            method: "native",
            fragments: [],
            reasons: kind === "duplicate" ? ["DUPLICATE_NATIVE_READING"] : [],
          };
      }
      expect(revisionTableCandidates(input.pages[0]!)).toEqual([]);
    },
  );
  it("abstains on duplicate headers and caps a crowded context", () => {
    const input = source();
    const header = input.pages[0]!.blocks.find((b) => b.id === "p1-b17")!;
    input.pages[0]!.blocks.push({ ...header, id: "duplicate-header" });
    expect(revisionTableCandidates(input.pages[0]!)).toEqual([]);
    input.pages[0]!.blocks = Array.from({ length: 201 }, (_, i) => ({
      ...header,
      id: String(i),
    }));
    expect(revisionTableCandidates(input.pages[0]!)).toEqual([]);
  });
  it("never confirms a colon-labelled revision from an excluded region", () => {
    const input = source();
    input.pages[0]!.blocks = [
      {
        ...input.pages[0]!.blocks[0]!,
        raw_text: "Редакция: 3",
        normalized_text: "Редакция: 3",
      },
    ];
    expect(identify(input).fields.revision_label).toBeUndefined();
    expect(
      identify(input).candidates.some(
        (item) => item.field === "revision_label",
      ),
    ).toBe(true);
  });
});
