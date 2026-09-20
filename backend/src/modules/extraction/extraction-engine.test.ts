import { describe, expect, it } from "vitest";
import type {
  ParseArtifactData,
  ParseBlock,
  ParsePage,
  ParseRegion,
} from "../parsing/parsing-contract.js";
import {
  contextWindows,
  findAnchorHits,
  normalizeTerm,
  pageTables,
  tableCandidates,
} from "./block-search.js";
import {
  PlanValidationError,
  validateExtractionPlan,
  type ExtractionPlan,
  type TableLookupPlan,
} from "./extraction-contract.js";
import {
  executeArtifact,
  executePlan,
  extractNumber,
  normalizeUnit,
  type ApprovedRule,
} from "./extraction-engine.js";

// Synthetic fixtures only; no real documents are used in unit tests.
let order = 0;
function textBlock(id: string, text: string, y = 0.1): ParseBlock {
  return {
    id,
    order: order++,
    kind: "text",
    raw_text: text,
    normalized_text: text,
    bbox: [0.1, y, 0.9, y + 0.05],
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

function cell(
  id: string,
  tableId: string,
  row: number,
  column: number,
  text: string,
  y = 0.3,
): ParseBlock {
  return {
    id,
    order: order++,
    kind: "table_cell",
    raw_text: text,
    normalized_text: text,
    bbox: [
      0.1 + column * 0.2,
      y + row * 0.03,
      0.28 + column * 0.2,
      y + row * 0.03 + 0.02,
    ],
    confidence: null,
    source: "native",
    structural_path: null,
    table_id: tableId,
    row,
    column,
    row_span: 1,
    column_span: 1,
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
    pages: pages.map((blocks, index): ParsePage => {
      order = 0;
      return {
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
      };
    }),
  };
}

function tepTable(tableId: string, areaValue: string, y = 0.3): ParseBlock[] {
  return [
    cell(`${tableId}-h0`, tableId, 0, 0, "Наименование показателя", y),
    cell(`${tableId}-h1`, tableId, 0, 1, "Ед. изм.", y),
    cell(`${tableId}-h2`, tableId, 0, 2, "Значение", y),
    cell(`${tableId}-10`, tableId, 1, 0, "Общая площадь здания", y),
    cell(`${tableId}-11`, tableId, 1, 1, "м2", y),
    cell(`${tableId}-12`, tableId, 1, 2, areaValue, y),
    cell(`${tableId}-20`, tableId, 2, 0, "Этажность", y),
    cell(`${tableId}-21`, tableId, 2, 1, "эт.", y),
    cell(`${tableId}-22`, tableId, 2, 2, "2", y),
  ];
}

const RULE: ApprovedRule = {
  parameter_code: "PZ-002",
  rule_version_id: "00000000-0000-4000-8000-000000000001",
  version: 1,
  plan: { kind: "regex", anchors: ["x"], pattern: "x" },
  comparison: null,
};

function planRule(plan: ExtractionPlan): ApprovedRule {
  return { ...RULE, plan };
}

describe("normalize/extract helpers", () => {
  it("normalizes case, ё and whitespace", () => {
    expect(normalizeTerm("  Общая\n Площадь  Ё ")).toBe("общая площадь е");
  });
  it("parses russian number formats", () => {
    expect(extractNumber("4 850,5")?.value).toBe(4850.5);
    expect(extractNumber("4\u00A0850")?.value).toBe(4850);
    expect(extractNumber("12 м2")?.value).toBe(12);
    expect(extractNumber("нет числа")).toBeNull();
  });
  it("normalizes unit aliases", () => {
    expect(normalizeUnit("м²")).toBe("m2");
    expect(normalizeUnit("кв.м")).toBe("m2");
    expect(normalizeUnit("М3")).toBe("m3");
  });
});

describe("block-search", () => {
  it("finds anchors case-insensitively", () => {
    const doc = artifact([textBlock("t1", "ОБЩАЯ ПЛОЩАДЬ здания")]);
    const hits = findAnchorHits(doc, ["общая площадь"]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.block.id).toBe("t1");
  });

  it("searches skipped-region text but skips OCR audit copies", () => {
    const region = (
      id: string,
      method: ParseRegion["method"],
    ): ParseRegion => ({
      id,
      kind: "unknown",
      bbox: [0, 0, 1, 1],
      raw_class: null,
      raw_score: null,
      method,
      reasons: [],
      table_status: "not_applicable",
    });
    const excluded = (
      id: string,
      regionId: string,
      text: string,
    ): ParseBlock => ({
      ...textBlock(id, text),
      region_id: regionId,
      include_in_main: false,
    });
    const doc = artifact([
      excluded("skip1", "r-skip", "Общая площадь здания"),
      excluded("audit1", "r-ocr", "Общая площадь здания"),
      {
        ...textBlock("ocr1", "Общая площадь здания"),
        region_id: "r-ocr",
        include_in_main: true,
        source: "ocr" as const,
      },
    ]);
    doc.pages[0]!.regions = [
      region("r-skip", "skipped"),
      region("r-ocr", "ocr"),
    ];
    const hits = findAnchorHits(doc, ["общая площадь"]);
    expect(hits.map((hit) => hit.block.id).sort()).toEqual(["ocr1", "skip1"]);
  });

  it("groups table cells into grids and scores by signature", () => {
    const doc = artifact([
      textBlock("cap", "Основные технико-экономические показатели", 0.2),
      ...tepTable("tab1", "4850"),
      ...tepTable("tab2", "999").map((b) => ({ ...b, table_id: "tab2" })),
    ]);
    const grids = pageTables(doc.pages[0]!);
    expect(grids).toHaveLength(2);
    const candidates = tableCandidates(doc, {
      any: ["показателя", "значение"],
      caption: ["технико-экономические"],
    });
    expect(candidates.length).toBe(2);
    expect(candidates[0]!.score).toBeGreaterThanOrEqual(4);
  });

  it("builds context windows with serialized tables", () => {
    const doc = artifact(tepTable("tab1", "4850"));
    const windows = contextWindows(doc, ["общая площадь"]);
    expect(windows).toHaveLength(1);
    expect(windows[0]!.table_id).toBe("tab1");
    expect(windows[0]!.lines.some((line) => line.text.includes("4850"))).toBe(
      true,
    );
  });
});

describe("table_lookup executor", () => {
  const plan: ExtractionPlan = {
    kind: "table_lookup",
    signature: { any: ["показателя", "значение"] },
    row: { anchors: ["общая площадь"] },
    value: { column: "last_numeric", unit: ["м2"] },
  };

  it("extracts a numeric value with unit and locators", () => {
    const doc = artifact(tepTable("tab1", "4 850"));
    const outcome = executePlan(doc, plan, planRule(plan));
    expect(outcome.status).toBe("extracted");
    expect(outcome.value).toBe(4850);
    expect(outcome.unit).toBe("m2");
    expect(outcome.evidence.length).toBeGreaterThan(0);
    expect(outcome.evidence[0]!.table_id).toBe("tab1");
  });

  it("reports ambiguous when two tables disagree", () => {
    const doc = artifact([
      ...tepTable("tab1", "4850"),
      ...tepTable("tab2", "4900").map((b) => ({ ...b, table_id: "tab2" })),
    ]);
    const outcome = executePlan(doc, plan, planRule(plan));
    expect(outcome.status).toBe("ambiguous");
    expect(outcome.alternatives?.map((a) => a.value)).toEqual([4850, 4900]);
  });

  it("returns no_evidence when signature misses", () => {
    const doc = artifact([textBlock("t1", "просто текст без таблиц")]);
    const outcome = executePlan(doc, plan, planRule(plan));
    expect(outcome.status).toBe("no_evidence");
  });
});

describe("regex executor", () => {
  it("extracts value near anchor", () => {
    const doc = artifact([textBlock("t1", "Этажность здания: 25 этажей")]);
    const plan: ExtractionPlan = {
      kind: "regex",
      anchors: ["этажность"],
      pattern: "(\\d+)\\s*этаж",
      type: "number",
    };
    const outcome = executePlan(doc, plan, planRule(plan));
    expect(outcome.status).toBe("extracted");
    expect(outcome.value).toBe(25);
  });
});

describe("cascade executor", () => {
  it("falls back from missing table to regex", () => {
    const doc = artifact([textBlock("t1", "Этажность: 3")]);
    const plan: ExtractionPlan = {
      kind: "cascade",
      steps: [
        {
          kind: "table_lookup",
          signature: { any: ["показателя"] },
          row: { anchors: ["этажность"] },
          value: {},
        },
        { kind: "regex", anchors: ["этажность"], pattern: ":\\s*(\\d+)" },
      ],
    };
    const outcome = executePlan(doc, plan, planRule(plan));
    expect(outcome.status).toBe("extracted");
    expect(outcome.value).toBe(3);
  });
});

describe("executeArtifact", () => {
  it("returns unsupported for a plan throwing inside", () => {
    const doc = artifact([textBlock("t1", "x")]);
    const broken = planRule({
      kind: "table_lookup",
      signature: { any: ["a"] },
      row: { anchors: [] },
      value: {},
    });
    // Bypass compile-time validation to simulate a stored bad plan.
    (broken.plan as TableLookupPlan).row.anchors = [];
    const outcomes = executeArtifact(doc, [broken]);
    expect(
      outcomes[0]!.status === "no_evidence" ||
        outcomes[0]!.status === "unsupported",
    ).toBe(true);
  });

  it("marks fully unreadable artifacts", () => {
    const doc = artifact([textBlock("t1", "x")]);
    doc.coverage.readable_pages = 0;
    doc.coverage.unreadable_pages = 1;
    const outcomes = executeArtifact(doc, [RULE]);
    expect(outcomes[0]!.status).toBe("unreadable");
  });
});

describe("validateExtractionPlan", () => {
  it("accepts a valid table_lookup plan", () => {
    const plan = validateExtractionPlan({
      kind: "table_lookup",
      signature: { any: ["ТЭП"], all: ["показатели"] },
      row: { anchors: ["общая площадь"] },
      value: { column: "last_numeric", type: "number", unit: ["м2"] },
    });
    expect(plan.kind).toBe("table_lookup");
  });
  it("rejects unknown kind, empty anchors and bad regex", () => {
    expect(() => validateExtractionPlan({ kind: "magic" })).toThrow(
      PlanValidationError,
    );
    expect(() =>
      validateExtractionPlan({
        kind: "regex",
        anchors: [],
        pattern: "x",
      }),
    ).toThrow(PlanValidationError);
    expect(() =>
      validateExtractionPlan({
        kind: "regex",
        anchors: ["a"],
        pattern: "([",
      }),
    ).toThrow(PlanValidationError);
  });
});
