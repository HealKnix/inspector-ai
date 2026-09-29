import { describe, expect, it } from "vitest";
import { buildClassificationContext } from "../identification/classification-context.js";
import { analysisBlocks } from "../parsing/analysis-blocks.js";
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
import { evaluateGroup } from "./comparison-engine.js";
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

describe("strict numeric extraction", () => {
  const number_policy = {
    version: "decimal-v1",
    mode: "single",
    reject_list_marker: true,
    require_unit: true,
  } as const;
  const plan = validateExtractionPlan({
    kind: "regex",
    anchors: ["Коэффициент застройки"],
    pattern: "Коэффициент застройки\\s*[:=]?\\s*([+−-]?\\d+(?:[.,]\\d+)?)\\s*%",
    unit: ["%"],
    number_policy,
  });
  const rule = {
    parameter_code: "P019",
    rule_version_id: "synthetic",
    version: 1,
    plan,
    comparison: null,
  };
  it("takes its own percent value, never a numbered item, and keeps its unit locator", () => {
    const result = executePlan(
      artifact([textBlock("own", "1. Коэффициент застройки: 36,25 %")]),
      plan,
      rule,
    );
    expect(result).toMatchObject({
      status: "extracted",
      value: "36.25",
      unit: "%",
      numerical: {
        decimal: "36.25",
        unit: { source: "value", canonical: "%" },
      },
    });
    expect(result.numerical!.unit.evidence[0]!.block_id).toBe("own");
    expect(
      executePlan(
        artifact([
          textBlock(
            "two",
            "Коэффициент застройки 36 %; Коэффициент застройки 37 %",
          ),
        ]),
        plan,
        rule,
      ).status,
    ).toBe("ambiguous");
    for (const text of [
      "Коэффициент застройки 1. Условия",
      "Коэффициент застройки 36,25",
    ]) {
      expect(
        executePlan(artifact([textBlock("missing", text)]), plan, rule).status,
      ).toBe("no_evidence");
    }
    const expected = {
      ...result,
      extraction_id: "PD",
      file_id: "PD",
      role: "expected" as const,
      stage: "PD",
    };
    const actual = {
      ...result,
      extraction_id: "RD",
      file_id: "RD",
      role: "actual" as const,
      stage: "RD",
    };
    expect(
      evaluateGroup([expected, actual], {
        kind: "no_increase",
        numerical_policy: {
          version: "decimal-units-v1",
          target_unit: "%",
          allow_percent_fraction: false,
          zero_expected: "not_comparable",
          rounding: null,
        },
      }).status,
    ).toBe("match");
  });
  it("rejects a multi-number cell and keeps high precision decimals", () => {
    const tablePlan = validateExtractionPlan({
      kind: "table_lookup",
      signature: { any: ["Коэффициент застройки"] },
      row: { anchors: ["Коэффициент застройки"] },
      value: { column: 1, unit: ["%"], number_policy },
    });
    for (const value of ["200 / 250 %", "1."]) {
      expect(
        executePlan(
          artifact([
            cell("label", "t", 0, 0, "Коэффициент застройки"),
            cell("value", "t", 0, 1, value),
          ]),
          tablePlan,
          { ...rule, plan: tablePlan },
        ).status,
      ).toBe("no_evidence");
    }
    const result = executePlan(
      artifact([
        cell("label", "t", 0, 0, "Коэффициент застройки"),
        cell("value", "t", 0, 1, "36.123456789012345678 %"),
      ]),
      tablePlan,
      { ...rule, plan: tablePlan },
    );
    expect(result.numerical?.decimal).toBe("36.123456789012345678");
  });
});
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
      native_valid: true,
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

  it("makes 46 explicitly valid skipped native locators available to ID and EXT without mutating the artifact", () => {
    const blocks = Array.from({ length: 46 }, (_, index) => ({
      ...textBlock(`native-${index}`, `Стадия: Р; локатор ${index}`),
      native_valid: true,
      include_in_main: false,
      region_id: "skip",
    }));
    const doc = artifact(blocks);
    const page = doc.pages[0]!;
    page.regions = [
      {
        id: "skip",
        kind: "unknown",
        bbox: [0, 0, 1, 1],
        raw_class: null,
        raw_score: null,
        method: "skipped",
        reasons: ["LAYOUT_UNCERTAIN"],
        table_status: "not_applicable",
      },
    ];
    const before = JSON.stringify(doc);
    expect(findAnchorHits(doc, ["локатор"]).map((hit) => hit.block.id)).toEqual(
      blocks.map((block) => block.id),
    );
    expect(
      new Set(
        buildClassificationContext(doc).fragments.map(
          (fragment) => fragment.block_id,
        ),
      ),
    ).toEqual(new Set(blocks.map((block) => block.id)));
    expect(analysisBlocks(page)[0]).toBe(blocks[0]);
    expect(JSON.stringify(doc)).toBe(before);
    delete page.blocks[0]!.native_valid;
    page.blocks[1]!.native_valid = false;
    page.blocks[2]!.provenance = {
      schema_version: 1,
      status: "ambiguous",
      method: "hybrid",
      fragments: [
        {
          source: "native",
          raw_text: "Стадия: Р",
          bbox: [0, 0, 1, 1],
          native_valid: true,
          role: "alternative",
        },
      ],
      reasons: ["TEXT_CONFLICT"],
    };
    page.regions.push({
      ...page.regions[0]!,
      id: "merged",
      kind: "table",
      method: "native_table",
      table_status: "structured",
    });
    page.blocks[3]!.region_id = "merged";
    const excluded = new Set(page.blocks.slice(0, 4).map((block) => block.id));
    expect(findAnchorHits(doc, ["локатор"])).toHaveLength(42);
    expect(
      buildClassificationContext(doc).fragments.every(
        (fragment) => !excluded.has(fragment.block_id),
      ),
    ).toBe(true);
    expect(
      contextWindows(doc, ["локатор"])
        .flatMap((window) => window.lines)
        .every((line) => !excluded.has(line.block_id ?? "")),
    ).toBe(true);
  });

  it("does not promote a suppressed duplicate native reading in a skipped region", () => {
    const primary: ParseBlock = {
      ...textBlock("primary", "Стадия: Р"),
      native_valid: true,
      include_in_main: false,
      region_id: "skip",
    };
    primary.provenance = {
      schema_version: 1,
      status: "selected",
      method: "native",
      fragments: [
        {
          source: "native",
          raw_text: primary.raw_text,
          bbox: [...primary.bbox],
          native_valid: true,
          role: "selected",
        },
      ],
      reasons: ["NATIVE_DUPLICATE_ALTERNATIVE_RETAINED"],
    };
    const duplicate: ParseBlock = {
      ...structuredClone(primary),
      id: "duplicate",
      provenance: {
        ...structuredClone(primary.provenance),
        reasons: ["DUPLICATE_NATIVE_READING"],
      },
    };
    const doc = artifact([primary, duplicate]);
    doc.pages[0]!.regions = [
      {
        id: "skip",
        kind: "unknown",
        bbox: [0, 0, 1, 1],
        raw_class: null,
        raw_score: null,
        method: "skipped",
        reasons: ["LAYOUT_UNCERTAIN"],
        table_status: "not_applicable",
      },
    ];
    expect(findAnchorHits(doc, ["Стадия"]).map((hit) => hit.block.id)).toEqual([
      "primary",
    ]);
    expect(
      buildClassificationContext(doc).fragments.map(
        (fragment) => fragment.block_id,
      ),
    ).toEqual(["primary"]);
    expect(doc.pages[0]!.blocks).toHaveLength(2);
  });

  it("uses an associated whole native row label while keeping 50 m³ in its original value cell", () => {
    const label = textBlock("native-label", "Бетон В25 Материал перекрытия");
    label.table_link = {
      schema_version: 1,
      status: "associated",
      table_id: "materials",
      rows: [1],
      columns: [0, 1],
      reasons: [],
    };
    const doc = artifact([
      cell("h0", "materials", 0, 0, "Обозначение"),
      cell("h1", "materials", 0, 1, "Наименование"),
      cell("h2", "materials", 0, 2, "Количество"),
      cell("r0", "materials", 1, 0, ""),
      cell("r1", "materials", 1, 1, ""),
      cell("quantity", "materials", 1, 2, "50 м³"),
      label,
    ]);
    const plan: TableLookupPlan = {
      kind: "table_lookup",
      signature: { any: ["Бетон В25"] },
      row: { anchors: ["Материал перекрытия"] },
      value: { column: 2, type: "number", unit: ["м³"] },
    };
    const before = JSON.stringify(doc);
    const result = executePlan(doc, plan, planRule(plan));
    expect(result).toMatchObject({
      status: "extracted",
      value: 50,
      unit: "m3",
    });
    expect(result.evidence.map((item) => item.block_id)).toEqual([
      "native-label",
      "quantity",
    ]);
    expect(result.evidence[0]).toMatchObject({
      table_id: null,
      table_row: null,
      table_column: null,
    });
    expect(result.evidence[1]).toMatchObject({
      table_id: "materials",
      table_row: 1,
      table_column: 2,
    });
    const windows = contextWindows(doc, ["Материал перекрытия"]);
    expect(windows).toHaveLength(1);
    expect(windows[0]!.table_id).toBe("materials");
    expect(windows[0]!.lines).toContainEqual({
      block_id: "native-label",
      text: "r1: Бетон В25 Материал перекрытия",
    });
    expect(windows[0]!.lines.some((line) => line.text.includes("50 м³"))).toBe(
      true,
    );
    expect(JSON.stringify(doc)).toBe(before);
    label.table_link.status = "ambiguous";
    label.table_link.reasons = ["TABLE_LINK_MULTIPLE_PARTS"];
    expect(contextWindows(doc, ["Материал перекрытия"])[0]!.lines).toEqual([
      { block_id: "native-label", text: "Бетон В25 Материал перекрытия" },
    ]);
    expect(executePlan(doc, plan, planRule(plan)).status).toBe("no_evidence");
    expect(findAnchorHits(doc, ["Бетон В25"])[0]!.block).toBe(label);
    expect(
      contextWindows(doc, ["Материал перекрытия"])[0]!.table_id,
    ).toBeNull();
  });

  it("does not let a regex window recover an excluded conflicting value from its neighbours", () => {
    const doc = artifact([
      textBlock("anchor", "Количество:"),
      {
        ...textBlock("bad", "50 м³"),
        native_valid: false,
        include_in_main: false,
      },
    ]);
    const plan: ExtractionPlan = {
      kind: "regex",
      anchors: ["Количество"],
      pattern: "Количество:\\s*(\\d+)",
      window_blocks: 1,
      unit: ["м³"],
    };
    expect(executePlan(doc, plan, planRule(plan)).status).toBe("no_evidence");
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

  it("merges a unitless hit into the same-valued group", () => {
    const doc = artifact([
      textBlock("t1", "Отметка 0,000 = 159,95 м"),
      textBlock("t2", "Абсолютная отметка: 159,95"),
    ]);
    const plan: ExtractionPlan = {
      kind: "regex",
      anchors: ["0,000", "абсолютная"],
      pattern: "(\\d{3}[,.]\\d{2})",
      type: "number",
      unit: ["м"],
    };
    const outcome = executePlan(doc, plan, planRule(plan));
    expect(outcome.status).toBe("extracted");
    expect(outcome.value).toBe(159.95);
    expect(outcome.unit).toBe("m");
  });

  it("stays ambiguous when units genuinely differ", () => {
    const doc = artifact([
      textBlock("t1", "Отметка 0,000 = 159,95 м"),
      textBlock("t2", "Повтор в км: 159,95 км"),
    ]);
    const plan: ExtractionPlan = {
      kind: "regex",
      anchors: ["0,000", "повтор"],
      pattern: "(\\d{3}[,.]\\d{2})",
      type: "number",
      // Longest unit first: "км" must win over the "м" substring.
      unit: ["км", "м"],
    };
    const outcome = executePlan(doc, plan, planRule(plan));
    expect(outcome.status).toBe("ambiguous");
    expect(outcome.alternatives?.map((item) => item.unit)).toEqual(["m", "km"]);
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
