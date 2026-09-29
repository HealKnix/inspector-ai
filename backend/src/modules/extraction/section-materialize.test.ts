import { describe, expect, it } from "vitest";
import {
  secArtifact,
  secCell,
  secPage,
  secText,
} from "../../../test/helpers/section-fixture.js";
import type {
  ParseBlock,
  ParseRegion,
  TextProvenance,
} from "../parsing/parsing-contract.js";
import type { ResolvedSource } from "./section-context.js";
import { sourceStream } from "./section-context.js";
import type { DiscoveredSection } from "./section-contract.js";
import {
  chunkSection,
  materializeSection,
  serializeBlock,
} from "./section-materialize.js";

// Synthetic fixtures only; no real documents are used in unit tests.

const BIG = 1_048_576;

function source(pages: ReturnType<typeof secPage>[]): ResolvedSource {
  const view = secArtifact("a".repeat(64), pages);
  return {
    info: {
      source_ref: "reference:0",
      role: "reference",
      document_id: "doc",
      revision_id: "rev",
      document_stage: "RD",
      file_id: "file",
      artifact_id: "art",
      artifact_sha256: "sha",
      source_sha256: "a".repeat(64),
      selection_hash: null,
      pages: view.pages.map((p) => p.page_number),
    },
    view,
    stream: sourceStream(view),
  };
}

function sectionOf(start: string, end: string): DiscoveredSection {
  return {
    section_id: "sec0",
    source_ref: "reference:0",
    title: "Раздел",
    start_block_id: start,
    end_block_id: end,
    parameter_codes: ["P1"],
  };
}

function ambiguous(id: string, text: string): ParseBlock {
  const block = secText(id, text);
  block.include_in_main = false;
  block.provenance = {
    schema_version: 1,
    status: "ambiguous",
    method: "hybrid",
    fragments: [
      {
        source: "native",
        raw_text: `${text}?`,
        bbox: [...block.bbox],
        native_valid: true,
        role: "alternative",
      },
      {
        source: "ocr",
        raw_text: text,
        bbox: [...block.bbox],
        native_valid: null,
        role: "alternative",
      },
    ],
    reasons: ["NATIVE_OCR_TEXT_CONFLICT"],
  };
  return block;
}

function provenance(
  fragments: TextProvenance["fragments"],
  reasons: string[],
  status: "selected" | "ambiguous" = "selected",
): TextProvenance {
  const sources = new Set(fragments.map((f) => f.source));
  return {
    schema_version: 1,
    status,
    method: sources.size > 1 ? "hybrid" : ([...sources][0] ?? "native"),
    fragments,
    reasons,
  };
}

const fragOf = (
  block: ParseBlock,
  role: "selected" | "alternative",
  source: "native" | "ocr" = block.source === "ocr" ? "ocr" : "native",
) => ({
  source,
  raw_text: block.raw_text,
  bbox: [...block.bbox] as [number, number, number, number],
  native_valid: source === "native" ? true : null,
  role,
});

describe("materializeSection", () => {
  it("returns the inclusive start..end range in reading order", () => {
    const s = source([
      secPage(1, [
        secText("a", "вне"),
        secText("h", "Раздел 1"),
        secText("b", "тело"),
        secText("c", "хвост"),
      ]),
    ]);
    const stream = materializeSection(s, sectionOf("h", "b"));
    expect(stream.map((i) => i.block.id)).toEqual(["h", "b"]);
  });

  it("rejects reversed or foreign bounds", () => {
    const s = source([secPage(1, [secText("a", "x"), secText("b", "y")])]);
    expect(() => materializeSection(s, sectionOf("b", "a"))).toThrowError(
      /section_materialize_invalid_bounds/,
    );
    expect(() => materializeSection(s, sectionOf("a", "zz"))).toThrowError(
      /section_materialize_invalid_bounds/,
    );
  });
});

describe("serializeBlock", () => {
  it("preserves associated-label row/column bindings without faking a cell", () => {
    const label = secText("lbl", "Графа значений");
    label.table_link = {
      schema_version: 1,
      status: "associated",
      table_id: "t1",
      rows: [2, 3],
      columns: [0],
      reasons: ["CROSS_COLUMN_NATIVE_TEXT"],
    };
    const s = source([secPage(1, [label, secCell("c1", "t1", 2, 0, "v")])]);
    const serialized = serializeBlock(s.stream[0]!);
    expect(serialized.kind).toBe("text");
    expect(serialized.table).toEqual({
      table_id: "t1",
      kind: "label",
      row: null,
      column: null,
      row_span: null,
      column_span: null,
      rows: [2, 3],
      columns: [0],
    });
  });
});

describe("chunkSection", () => {
  it("keeps a nonconsecutive table grid atomic, including intervening text", () => {
    const s = source([
      secPage(1, [
        secCell("c1", "T", 0, 0, "a"),
        secText("gap", "между ячейками"),
        secCell("c2", "T", 1, 0, "b"),
      ]),
    ]);
    const m = chunkSection(s, sectionOf("c1", "c2"), BIG, 4000);
    // One atomic unit → exactly one chunk; nothing omitted.
    expect(m.chunks).toHaveLength(1);
    expect(m.chunks[0]!.blocks.map((b) => b.block_id)).toEqual([
      "c1",
      "gap",
      "c2",
    ]);
    expect(m.omitted_block_ids).toEqual([]);
  });

  it("drops a whole grid when one member is oversized — never a partial table", () => {
    const cell = secCell("big", "T", 1, 0, "x".repeat(50));
    const s = source([
      secPage(1, [
        secCell("c1", "T", 0, 0, "a"),
        secText("mid", "между"),
        cell,
        secText("tail", "конец"),
      ]),
    ]);
    const m = chunkSection(s, sectionOf("c1", "tail"), BIG, 10);
    expect(m.omitted_block_ids).toEqual(["c1", "mid", "big"]);
    expect(m.chunks.flatMap((c) => c.blocks.map((b) => b.block_id))).toEqual([
      "tail",
    ]);
  });

  it("splits oversized single blocks without splitting the stream silently", () => {
    const s = source([
      secPage(1, [
        secText("a", "ok"),
        secText("big", "x".repeat(50)),
        secText("b", "ok2"),
      ]),
    ]);
    const m = chunkSection(s, sectionOf("a", "b"), BIG, 10);
    expect(m.omitted_block_ids).toEqual(["big"]);
    expect(m.chunks.flatMap((c) => c.blocks.map((b) => b.block_id))).toEqual([
      "a",
      "b",
    ]);
  });

  it("marks a selected ABSTAIN middle page between endpoints as unreadable", () => {
    const s = source([
      secPage(1, [secText("h", "Раздел 1"), secText("t1", "тело")]),
      secPage(2, [], { quality: "ABSTAIN", reasons: ["unreadable"] }),
      secPage(3, [secText("t2", "конец")]),
    ]);
    const m = chunkSection(s, sectionOf("h", "t2"), BIG, 4000);
    expect(m.unreadable_pages).toEqual([2]);
    expect(m.filtered_block_ids).toEqual([]);
  });

  it("reports ambiguous prefixes/tails on continuation pages (unbounded edge)", () => {
    const s = source([
      secPage(1, [
        secText("h", "Раздел 1"),
        secText("t1", "тело"),
        ambiguous("tail", "спорный хвост"), // after last eligible on page 1
      ]),
      secPage(2, [
        ambiguous("prefix", "спорное начало"), // before first eligible on page 2
        secText("t2", "конец"),
      ]),
    ]);
    const m = chunkSection(s, sectionOf("h", "t2"), BIG, 4000);
    expect(m.filtered_block_ids).toEqual(["tail", "prefix"]);
    expect(m.unreadable_pages).toEqual([]);
  });

  it("ignores excluded blocks outside a single-page section range", () => {
    const s = source([
      secPage(1, [
        ambiguous("before", "снаружи"),
        secText("h", "Раздел 1"),
        secText("t", "тело"),
        ambiguous("after", "снаружи"),
      ]),
    ]);
    const m = chunkSection(s, sectionOf("h", "t"), BIG, 4000);
    expect(m.filtered_block_ids).toEqual([]);
  });

  it("reports a real ambiguous block inside the bounds as filtered", () => {
    const s = source([
      secPage(1, [
        secText("h", "Раздел 1"),
        ambiguous("amb", "спорный текст"),
        secText("t", "конец"),
      ]),
    ]);
    const m = chunkSection(s, sectionOf("h", "t"), BIG, 4000);
    expect(m.filtered_block_ids).toEqual(["amb"]);
  });

  it("does not flag a native line absorbed into an accepted table cell", () => {
    // pdf_fusion reconcile_table: the consumed line is hidden
    // (include_in_main=false) while the accepted cell retains it as a
    // selected provenance fragment.
    const line = secText("line", "содержимое строки");
    line.include_in_main = false;
    line.native_valid = true;
    line.provenance = provenance([fragOf(line, "selected")], []);
    const cell = secCell("cell", "T", 0, 0, "содержимое строки и ещё");
    cell.provenance = provenance(
      [fragOf(line, "selected"), fragOf(cell, "alternative")],
      ["TABLE_TEXT_FROM_LOCATED_FRAGMENTS"],
    );
    const s = source([secPage(1, [secText("h", "Раздел 1"), line, cell])]);
    // The hidden line sits between the endpoints: it is excluded from the
    // stream but its text is retained by the accepted cell.
    const m = chunkSection(s, sectionOf("h", "cell"), BIG, 4000);
    expect(m.filtered_block_ids).toEqual([]);
    expect(m.chunks.flatMap((c) => c.blocks.map((b) => b.block_id))).toContain(
      "cell",
    );
  });

  it("does not flag an OCR duplicate whose twin is retained", () => {
    const twin = secText("keep", "одинаковое чтение");
    twin.source = "ocr";
    const dup = secText("dup", "одинаковое чтение");
    dup.source = "ocr";
    dup.include_in_main = false;
    // The hidden duplicate's provenance names the retained twin — the
    // fragment carries the twin's own raw_text + bbox.
    dup.provenance = provenance(
      [fragOf(dup, "alternative", "ocr"), fragOf(twin, "selected", "ocr")],
      ["DUPLICATE_OCR_READING"],
    );
    const s = source([
      secPage(1, [secText("h", "Раздел 1"), dup, twin, secText("t", "конец")]),
    ]);
    const m = chunkSection(s, sectionOf("h", "t"), BIG, 4000);
    expect(m.filtered_block_ids).toEqual([]);
  });

  it("does not flag a duplicate whose named twin survives inside a cell", () => {
    // Chain from pdf_fusion: an OCR duplicate of a native line is hidden;
    // then the native line is absorbed into an accepted table cell and
    // hidden itself. The ink survives only as the cell's selected fragment.
    const twin = secText("twin", "дублированная строка");
    twin.include_in_main = false;
    twin.native_valid = true;
    twin.provenance = provenance([fragOf(twin, "selected")], []);
    const dup = secText("dup", "дублированная строка");
    dup.source = "ocr";
    dup.include_in_main = false;
    dup.provenance = provenance(
      [fragOf(dup, "alternative", "ocr"), fragOf(twin, "selected")],
      ["DUPLICATE_OCR_READING"],
    );
    const cell = secCell("cell", "T", 0, 0, "дублированная строка | иное");
    cell.provenance = provenance(
      [fragOf(twin, "selected"), fragOf(cell, "alternative")],
      ["TABLE_TEXT_FROM_LOCATED_FRAGMENTS"],
    );
    const s = source([secPage(1, [secText("h", "Раздел 1"), dup, twin, cell])]);
    const m = chunkSection(s, sectionOf("h", "cell"), BIG, 4000);
    expect(m.filtered_block_ids).toEqual([]);
  });

  it("flags a duplicate reading when no eligible twin retains it", () => {
    const dup = secText("dup", "утерянное чтение");
    dup.source = "ocr";
    dup.include_in_main = false;
    dup.provenance = provenance(
      [fragOf(dup, "selected", "ocr")],
      ["DUPLICATE_OCR_READING"],
    );
    const s = source([
      secPage(1, [secText("h", "Раздел 1"), dup, secText("t", "конец")]),
    ]);
    const m = chunkSection(s, sectionOf("h", "t"), BIG, 4000);
    expect(m.filtered_block_ids).toEqual(["dup"]);
  });

  it("flags same text at a different bbox — identical text is not retention", () => {
    // An eligible block elsewhere on the page happens to carry the same
    // string; the hidden block's provenance does not link to it.
    const elsewhere = secText("else", "300");
    elsewhere.source = "ocr";
    // A different ink location: neither the block nor its own fragment may
    // coincide with the eligible look-alike.
    const hidden = secText("hidden", "300", 0.55);
    hidden.source = "ocr";
    hidden.include_in_main = false;
    hidden.provenance = provenance(
      [
        fragOf(hidden, "alternative", "ocr"),
        {
          source: "ocr",
          raw_text: "300",
          bbox: [0.5, 0.9, 0.6, 0.95], // a different ink location entirely
          native_valid: null,
          role: "selected",
        },
      ],
      ["DUPLICATE_OCR_READING"],
    );
    const s = source([
      secPage(1, [
        secText("h", "Раздел 1"),
        hidden,
        secText("t", "конец"),
        elsewhere,
      ]),
    ]);
    const m = chunkSection(s, sectionOf("h", "else"), BIG, 4000);
    expect(m.filtered_block_ids).toEqual(["hidden"]);
  });

  it("flags an invalid native line without proven replacement", () => {
    const valid = secText("valid", "300");
    const invalid = secText("invalid", "300");
    invalid.native_valid = false;
    invalid.include_in_main = false;
    // Not ambiguous, but nothing retains this ink: same text elsewhere is
    // not a replacement.
    invalid.provenance = provenance([fragOf(invalid, "alternative")], []);
    const s = source([
      secPage(1, [
        secText("h", "Раздел 1"),
        invalid,
        secText("t", "конец"),
        valid,
      ]),
    ]);
    const m = chunkSection(s, sectionOf("h", "valid"), BIG, 4000);
    expect(m.filtered_block_ids).toEqual(["invalid"]);
  });

  it("packs blocks into byte-bounded chunks", () => {
    const s = source([
      secPage(1, [
        secText("h", "Раздел 1"),
        secText("a", "а".repeat(300)),
        secText("b", "б".repeat(300)),
        secText("c", "в".repeat(300)),
      ]),
    ]);
    const m = chunkSection(s, sectionOf("h", "c"), 900, 4000);
    expect(m.chunks.length).toBeGreaterThan(1);
    for (const chunk of m.chunks) expect(chunk.bytes).toBeLessThanOrEqual(900);
    expect(m.chunks.flatMap((c) => c.blocks.map((b) => b.block_id))).toEqual([
      "h",
      "a",
      "b",
      "c",
    ]);
    expect(m.chunks.map((c, i) => [i, c.index])).toEqual(
      m.chunks.map((_, i) => [i, i]),
    );
  });
});

describe("unresolved regions", () => {
  const region = (over: Partial<ParseRegion>): ParseRegion => ({
    id: "reg",
    kind: "table",
    bbox: [0.1, 0.1, 0.9, 0.5],
    raw_class: null,
    raw_score: null,
    method: "native_table",
    reasons: [],
    table_status: "unreadable",
    ...over,
  });

  it("flags an unreadable table region on a page with readable text", () => {
    // The grid never produced cells: sibling text staying readable does not
    // make the absent table content present.
    const s = source([
      secPage(1, [secText("h", "Раздел 1"), secText("b", "текст")], {
        regions: [region({ id: "t1" })],
      }),
    ]);
    const m = chunkSection(s, sectionOf("h", "b"), BIG, 4000);
    expect(m.unresolved_regions).toEqual(["1:t1"]);
    expect(m.filtered_block_ids).toEqual([]);
  });

  it("flags an unknown region that produced no eligible blocks", () => {
    const s = source([
      secPage(1, [secText("h", "Раздел 1"), secText("b", "текст")], {
        regions: [
          region({
            id: "u1",
            kind: "unknown",
            method: "hybrid",
            table_status: "not_applicable",
          }),
          // A skipped pass is harmless only when a valid native reading is
          // retained — an unserved unknown region is still missing ink.
          region({
            id: "u2",
            kind: "unknown",
            method: "skipped",
            table_status: "not_applicable",
          }),
        ],
      }),
    ]);
    const m = chunkSection(s, sectionOf("h", "b"), BIG, 4000);
    expect(m.unresolved_regions).toEqual(["1:u1", "1:u2"]);
  });

  it("keeps graphic, skipped and served regions out of coverage gaps", () => {
    const cell = {
      ...secCell("c1", "grid", 0, 0, "x"),
      region_id: "t1",
      include_in_main: true,
    };
    const head = {
      ...secText("h", "Раздел 1"),
      region_id: "txt",
      include_in_main: true,
    };
    const kept = {
      ...secText("k", "нативная строка"),
      region_id: "s2",
      include_in_main: true,
    };
    const s = source([
      secPage(1, [head, cell, kept, secText("b", "конец")], {
        regions: [
          region({ id: "t1", table_status: "structured" }),
          region({ id: "txt", kind: "text", table_status: "not_applicable" }),
          region({ id: "g1", kind: "graphic", table_status: "not_applicable" }),
          region({ id: "s1", kind: "text", method: "skipped" }),
          // Skipped unknown is harmless only because a valid native block
          // still represents its ink.
          region({
            id: "s2",
            kind: "unknown",
            method: "skipped",
            table_status: "not_applicable",
          }),
        ],
      }),
    ]);
    const m = chunkSection(s, sectionOf("h", "b"), BIG, 4000);
    expect(m.unresolved_regions).toEqual([]);
  });
});
