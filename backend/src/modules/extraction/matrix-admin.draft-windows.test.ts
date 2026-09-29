import { describe, expect, it } from "vitest";
import type {
  ParseArtifactData,
  ParseBlock,
  ParsePage,
} from "../parsing/parsing-contract.js";
import { draftWindows } from "./matrix-admin.service.js";

// Synthetic fixtures only; no real documents are used in unit tests.
function textBlock(id: string, text: string, y: number): ParseBlock {
  return {
    id,
    order: 0,
    kind: "text",
    raw_text: text,
    normalized_text: text,
    bbox: [0.1, y, 0.9, y + 0.02],
    confidence: null,
    source: "native",
    structural_path: null,
    table_id: null,
    row: null,
    column: null,
    row_span: null,
    column_span: null,
  };
}

function artifact(...pages: ParseBlock[][]): ParseArtifactData {
  return {
    schema_version: 1,
    source_sha256: "a".repeat(64),
    pipeline_fingerprint: "b".repeat(64),
    versions: { parser: "synthetic" },
    raw_text: "FULL",
    normalized_text: "FULL",
    quality: "OK",
    reasons: [],
    coverage: {
      total_pages: pages.length,
      readable_pages: pages.length,
      unreadable_pages: 0,
    },
    pages: pages.map((blocks, index): ParsePage => ({
      page_number: index + 1,
      sheet_label: null,
      width: 100,
      height: 100,
      image_key: "00000000-0000-4000-8000-000000000000",
      image_sha256: "c".repeat(64),
      quality: "OK",
      reasons: [],
      transform: {
        coordinate_space: "visible-page-normalized",
        renderer: "synthetic",
        render_width: 100,
        render_height: 100,
        media_box: [0, 0, 100, 100],
        crop_box: [0, 0, 100, 100],
        rotation: 0,
        pdf_to_visible: [1, 0, 0, 1, 0, 0],
        visible_to_pdf: [1, 0, 0, 1, 0, 0],
      },
      blocks,
    })),
  };
}

/** One matching text block per page => one window per page. */
function chattyArtifact(pages: number, marker: string): ParseArtifactData {
  const pageBlocks: ParseBlock[][] = [];
  for (let i = 0; i < pages; i += 1) {
    pageBlocks.push([
      textBlock(`p${i}-a`, `лист ${i} ${marker}`, 0.1),
      textBlock(`p${i}-b`, "прочий текст", 0.5),
    ]);
  }
  return artifact(...pageBlocks);
}

function source(fileId: string, data: ParseArtifactData) {
  return { file_id: fileId, artifact: data };
}

describe("draftWindows", () => {
  it("returns empty when nothing matches", () => {
    const sources = [
      source("a", artifact([textBlock("t1", "совсем другое", 0.1)])),
    ];
    expect(draftWindows(sources, ["площадь застройки"])).toEqual([]);
  });

  it("round-robin across artifacts: a chatty file cannot starve the rest", () => {
    // 20 pages of hits in file A (its own cap is 16 windows), one hit in B.
    const sources = [
      source("a", chattyArtifact(20, "показател")),
      source("b", artifact([textBlock("b1", "сводка показателей", 0.1)])),
    ];
    const windows = draftWindows(sources, ["показател"]);
    expect(windows.length).toBe(16);
    expect(windows.some((w) => w.file_id === "b")).toBe(true);
  });

  it("ranks windows containing the parameter name first", () => {
    const sources = [
      source("a", chattyArtifact(8, "показател")),
      source(
        "b",
        artifact([
          textBlock("b1", "площадь застройки 100 м2", 0.1),
          textBlock("b2", "показатели объекта", 0.5),
        ]),
      ),
    ];
    const windows = draftWindows(sources, ["площадь застройки", "показател"]);
    expect(windows[0]!.file_id).toBe("b");
    expect(windows[0]!.lines.map((l) => l.text).join(" ")).toContain(
      "площадь застройки",
    );
  });
});
