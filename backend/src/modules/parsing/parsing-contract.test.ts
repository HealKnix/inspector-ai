import { ConfigService } from "@nestjs/config";
import { Ajv } from "ajv";
import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PrivateStorageService } from "../../infrastructure/storage/private-storage.service.js";
import { ArtifactStorageService } from "./artifact-storage.service.js";
import {
  validateArtifact,
  validateMessage,
  type ParseArtifactData,
  type ParseBlock,
  type ParseRegion,
} from "./parsing-contract.js";
import { parseArtifactSchema } from "./parsing-openapi.js";

const hash = "a".repeat(64);
function fixture(): ParseArtifactData {
  return {
    schema_version: 1,
    source_sha256: hash,
    pipeline_fingerprint: hash,
    versions: { parser: "synthetic-v1" },
    raw_text: "Шифр-А.1",
    normalized_text: "Шифр-А.1",
    quality: "OK",
    reasons: [],
    coverage: { total_pages: 1, readable_pages: 1, unreadable_pages: 0 },
    pages: [
      {
        page_number: 1,
        sheet_label: "Лист 07",
        width: 100,
        height: 200,
        image_key: randomUUID(),
        image_sha256: hash,
        quality: "OK",
        reasons: [],
        transform: {
          renderer: "synthetic-v1",
          coordinate_space: "visible-page-normalized",
          render_width: 100,
          render_height: 200,
          media_box: [0, 0, 100, 200],
          crop_box: [0, 0, 100, 200],
          rotation: 0,
          pdf_to_visible: [1, 0, 0, 1, 0, 0],
          visible_to_pdf: [1, 0, 0, 1, 0, 0],
        },
        blocks: [
          {
            id: "p1:b1",
            order: 0,
            kind: "text",
            raw_text: "Шифр-А.1",
            normalized_text: "Шифр-А.1",
            bbox: [0.1, 0.2, 0.4, 0.5],
            confidence: null,
            source: "native",
            structural_path: null,
            table_id: null,
            row: null,
            column: null,
            row_span: null,
            column_span: null,
          },
        ],
      },
    ],
  };
}
function cell(
  order: number,
  row: number,
  column: number,
  rowSpan = 1,
  columnSpan = 1,
  tableId = "table-1",
): ParseBlock {
  return {
    id: `p1:cell-${order}`,
    order,
    kind: "table_cell",
    raw_text: "",
    normalized_text: "",
    bbox: [0.1, 0.2, 0.4, 0.5],
    confidence: 0.9,
    source: "ocr",
    structural_path: null,
    table_id: tableId,
    row,
    column,
    row_span: rowSpan,
    column_span: columnSpan,
  };
}
function tableFixture(cells: ParseBlock[]) {
  const input = fixture();
  return { ...input, pages: [{ ...input.pages[0]!, blocks: cells }] };
}

function regionalFixture(): ParseArtifactData {
  const input = fixture();
  input.region_schema_version = 1;
  input.versions.pdf_region_profile = "paddle-regions-v1";
  input.pages[0]!.regions = [
    {
      id: "p1:r1",
      kind: "text",
      bbox: [0, 0, 1, 1],
      raw_class: "text",
      raw_score: 0.93,
      method: "native",
      reasons: [],
      table_status: "not_applicable",
    },
  ];
  input.pages[0]!.blocks[0]!.region_id = "p1:r1";
  input.pages[0]!.blocks[0]!.include_in_main = true;
  return input;
}

describe("regional PDF trust boundary", () => {
  it("preserves complete text, excluded native labels and cross-boundary glyph geometry", () => {
    const input = regionalFixture();
    const page = input.pages[0]!;
    page.regions!.push({
      id: "p1:r2",
      kind: "graphic",
      bbox: [0.6, 0.6, 1, 1],
      raw_class: "image",
      raw_score: 0.8,
      method: "skipped",
      reasons: ["graphic_preserved"],
      table_status: "not_applicable",
    });
    page.blocks.push({
      ...page.blocks[0]!,
      id: "p1:b2",
      order: 1,
      region_id: "p1:r2",
      include_in_main: false,
      raw_text: "−1,200 ± 0,05",
      normalized_text: "−1,200 ± 0,05",
      bbox: [0.5, 0.5, 0.9, 0.9],
    });
    input.raw_text += "\n−1,200 ± 0,05";
    input.normalized_text = input.raw_text;
    const original = JSON.stringify(input);
    const result = validateArtifact(input, hash, hash);
    expect(result).toBe(input);
    expect(JSON.stringify(result)).toBe(original);
    expect(result.pages[0]!.blocks[1]!.include_in_main).toBe(false);
  });

  it("accepts planned graphic-only skip with OK quality and no textual coverage", () => {
    const input = regionalFixture();
    input.raw_text = input.normalized_text = "";
    input.pages[0]!.blocks = [];
    Object.assign(input.pages[0]!.regions![0]!, {
      kind: "graphic",
      method: "skipped",
      raw_class: "chart",
      reasons: ["graphic_preserved"],
    });
    input.coverage = { total_pages: 1, readable_pages: 0, unreadable_pages: 1 };
    expect(validateArtifact(input, hash, hash).quality).toBe("OK");
    input.coverage = { total_pages: 1, readable_pages: 1, unreadable_pages: 0 };
    expect(() => validateArtifact(input, hash, hash)).toThrow(
      "parser_invalid_result",
    );
  });

  it("accepts uncovered unknown regions with no invented Paddle class or score", () => {
    const input = regionalFixture();
    Object.assign(input.pages[0]!.regions![0]!, {
      kind: "unknown",
      method: "skipped",
      raw_class: null,
      raw_score: null,
      reasons: ["native_outside_layout"],
    });
    input.pages[0]!.blocks[0]!.include_in_main = false;
    expect(
      validateArtifact(input, hash, hash).pages[0]!.regions![0]!.raw_class,
    ).toBeNull();
  });

  it("accepts partial native text, OCR replacements and excluded invalid native in active areas", () => {
    const input = regionalFixture();
    const page = input.pages[0]!;
    page.regions![0]!.method = "hybrid";
    page.blocks.push({
      ...page.blocks[0]!,
      id: "p1:b2",
      order: 1,
      source: "ocr",
    });
    expect(() => validateArtifact(input, hash, hash)).not.toThrow();
    page.regions![0]!.method = "ocr";
    page.blocks[0]!.include_in_main = false;
    expect(() => validateArtifact(input, hash, hash)).not.toThrow();
    page.blocks[0]!.include_in_main = true;
    expect(() => validateArtifact(input, hash, hash)).toThrow(
      "parser_invalid_result",
    );
  });

  it.each(["native_table", "table_ocr", "hybrid"] as const)(
    "accepts %s with valid empty cells and preserves unconfirmed text",
    (method) => {
      const input = regionalFixture();
      const page = input.pages[0]!;
      Object.assign(page.regions![0]!, {
        kind: "table",
        raw_class: "table",
        method,
        table_status: "structured",
      });
      page.blocks[0]!.include_in_main = method !== "table_ocr";
      page.blocks.push({
        ...cell(1, 0, 0),
        region_id: "p1:r1",
        include_in_main: true,
        source: method === "native_table" ? "native" : "ocr",
      });
      expect(
        validateArtifact(input, hash, hash).pages[0]!.blocks[1]!.raw_text,
      ).toBe("");
      page.blocks.pop();
      page.regions![0]!.table_status = "unconfirmed";
      page.regions![0]!.reasons = ["table_structure_unconfirmed"];
      expect(() => validateArtifact(input, hash, hash)).not.toThrow();
    },
  );

  const malformed: [string, (input: ParseArtifactData) => void][] = [
    [
      "missing marker for the new profile",
      (input) => {
        delete input.region_schema_version;
      },
    ],
    [
      "missing regions",
      (input) => {
        delete input.pages[0]!.regions;
      },
    ],
    [
      "missing block link",
      (input) => {
        delete input.pages[0]!.blocks[0]!.region_id;
      },
    ],
    [
      "missing main flag",
      (input) => {
        delete input.pages[0]!.blocks[0]!.include_in_main;
      },
    ],
    [
      "foreign region reference",
      (input) => {
        input.pages[0]!.blocks[0]!.region_id = "p2:r1";
      },
    ],
    [
      "duplicate region ID",
      (input) => {
        input.pages[0]!.regions!.push({ ...input.pages[0]!.regions![0]! });
      },
    ],
    [
      "non-finite coordinates",
      (input) => {
        input.pages[0]!.regions![0]!.bbox[2] = Infinity;
      },
    ],
    [
      "inverted coordinates",
      (input) => {
        input.pages[0]!.regions![0]!.bbox = [0.5, 0, 0.1, 1];
      },
    ],
    [
      "out-of-page coordinates",
      (input) => {
        input.pages[0]!.regions![0]!.bbox[0] = -0.01;
      },
    ],
    [
      "non-finite score",
      (input) => {
        input.pages[0]!.regions![0]!.raw_score = NaN;
      },
    ],
    [
      "unbounded class",
      (input) => {
        input.pages[0]!.regions![0]!.raw_class = "x".repeat(129);
      },
    ],
    [
      "native with OCR output",
      (input) => {
        input.pages[0]!.blocks[0]!.source = "ocr";
      },
    ],
    [
      "text treated as table",
      (input) => {
        input.pages[0]!.regions![0]!.method = "native_table";
      },
    ],
    [
      "structured table without cells",
      (input) => {
        Object.assign(input.pages[0]!.regions![0]!, {
          kind: "table",
          method: "native_table",
          table_status: "structured",
        });
      },
    ],
    [
      "unconfirmed table without explanation",
      (input) => {
        Object.assign(input.pages[0]!.regions![0]!, {
          kind: "table",
          method: "native_table",
          table_status: "unconfirmed",
        });
      },
    ],
    [
      "empty OCR text",
      (input) => {
        input.pages[0]!.regions![0]!.method = "ocr";
        Object.assign(input.pages[0]!.blocks[0]!, {
          source: "ocr",
          raw_text: " \n\t",
          normalized_text: "",
        });
      },
    ],
  ];
  it.each(malformed)(
    "rejects %s in fresh and stored regional artifacts",
    (_, mutate) => {
      const input = regionalFixture();
      mutate(input);
      for (const mode of ["strict", "stored"] as const)
        expect(() => validateArtifact(input, hash, hash, mode)).toThrow(
          "parser_invalid_result",
        );
    },
  );

  it.each([
    "id",
    "kind",
    "bbox",
    "raw_class",
    "raw_score",
    "method",
    "reasons",
    "table_status",
  ])("requires region field %s", (field) => {
    const input = regionalFixture();
    Reflect.deleteProperty(input.pages[0]!.regions![0]!, field);
    expect(() => validateArtifact(input, hash, hash)).toThrow(
      "parser_invalid_result",
    );
  });

  it("scopes region references to a page and prevents a table spanning regions", () => {
    const input = regionalFixture();
    const first = input.pages[0]!;
    input.pages.push({
      ...first,
      page_number: 2,
      image_key: randomUUID(),
      regions: [{ ...first.regions![0]!, id: "p2:r1" }],
      blocks: [{ ...first.blocks[0]!, id: "p2:b1", region_id: "p2:r1" }],
    });
    input.coverage = { total_pages: 2, readable_pages: 2, unreadable_pages: 0 };
    expect(() => validateArtifact(input, hash, hash)).not.toThrow();
    first.blocks[0]!.region_id = "p2:r1";
    expect(() => validateArtifact(input, hash, hash)).toThrow();

    const table = regionalFixture();
    const page = table.pages[0]!;
    Object.assign(page.regions![0]!, {
      kind: "table",
      method: "native_table",
      table_status: "structured",
    });
    page.regions!.push({ ...page.regions![0]!, id: "p1:r2" });
    page.blocks = [0, 1].map((index) => ({
      ...cell(index, index, 0),
      raw_text: "ячейка",
      normalized_text: "ячейка",
      source: "native",
      region_id: `p1:r${index + 1}`,
      include_in_main: true,
    }));
    expect(() => validateArtifact(table, hash, hash)).toThrow();
  });

  it.each(["graphic", "unknown"] as const)(
    "rejects OCR and main inclusion in %s",
    (kind) => {
      const input = regionalFixture();
      const region = input.pages[0]!.regions![0]!;
      Object.assign(region, {
        kind,
        method: "skipped",
        reasons: ["region_skipped"],
      });
      const block = input.pages[0]!.blocks[0]!;
      expect(() => validateArtifact(input, hash, hash)).toThrow();
      block.include_in_main = false;
      block.source = "ocr";
      expect(() => validateArtifact(input, hash, hash)).toThrow();
      block.source = "native";
      region.method = "ocr";
      expect(() => validateArtifact(input, hash, hash)).toThrow();
    },
  );

  it("bounds region arrays and rejects unknown schema versions", () => {
    const input = regionalFixture();
    input.pages[0]!.regions = Array.from(
      { length: 10_001 },
      (_, i): ParseRegion => ({
        id: `r${i}`,
        kind: "text",
        bbox: [0, 0, 1, 1],
        raw_class: "text",
        raw_score: 0.9,
        method: "native",
        reasons: [],
        table_status: "not_applicable",
      }),
    );
    expect(() => validateArtifact(input, hash, hash)).toThrow();
    expect(() =>
      validateArtifact(
        { ...regionalFixture(), region_schema_version: 2 },
        hash,
        hash,
      ),
    ).toThrow();
  });

  it("keeps genuine legacy PDFs readable but does not accept unversioned partial regions", () => {
    expect(
      validateArtifact(fixture(), hash, hash, "stored").region_schema_version,
    ).toBeUndefined();
    const input = fixture();
    expect(() =>
      validateArtifact(
        { ...input, pages: [{ ...input.pages[0]!, regions: [] }] },
        hash,
        hash,
        "stored",
      ),
    ).toThrow();
    const structured = fixture();
    const page = structured.pages[0]!;
    const currentDocx = {
      ...structured,
      versions: {
        parser: "synthetic-v1",
        pdf_region_profile: "paddle-regions-v1",
      },
      pages: [
        {
          ...page,
          transform: {
            ...page.transform,
            structural_mapping: true,
            font_sha256: hash,
            layout: "semantic-structure-v1",
          },
        },
      ],
    };
    expect(() => validateArtifact(currentDocx, hash, hash)).not.toThrow();
  });

  it("documents region fields and completeness in the published OpenAPI schema", () => {
    const validate = new Ajv({ strict: false, validateFormats: false }).compile(
      parseArtifactSchema,
    );
    expect(validate(regionalFixture()), JSON.stringify(validate.errors)).toBe(
      true,
    );
    expect(validate(fixture()), JSON.stringify(validate.errors)).toBe(true);
    const input = regionalFixture();
    delete input.pages[0]!.blocks[0]!.region_id;
    expect(validate(input)).toBe(false);
    input.pages[0]!.blocks[0]!.region_id = "p1:r1";
    delete input.pages[0]!.regions;
    expect(validate(input)).toBe(false);
  });
});
describe("parser trust boundary", () => {
  it("preserves source text and physical page/sheet distinction", () => {
    const value = validateArtifact(fixture(), hash, hash);
    expect(value.raw_text).toBe("Шифр-А.1");
    expect(value.pages[0]?.sheet_label).toBe("Лист 07");
  });
  it.each(["source_sha256", "pipeline_fingerprint"])(
    "rejects foreign %s",
    (key) => {
      const input = fixture();
      expect(() =>
        validateArtifact({ ...input, [key]: "b".repeat(64) }, hash, hash),
      ).toThrow("parser_invalid_result");
    },
  );
  it("rejects leaked domain binding, filesystem paths and invalid bounds", () => {
    expect(() =>
      validateArtifact({ ...fixture(), object_id: randomUUID() }, hash, hash),
    ).toThrow();
    const input = fixture();
    expect(() =>
      validateArtifact(
        {
          ...input,
          pages: [{ ...input.pages[0], image_key: "../originals/file" }],
        },
        hash,
        hash,
      ),
    ).toThrow();
    const other = fixture();
    other.pages[0]!.blocks[0]!.bbox = [0, 0, 1.1, 0.5];
    expect(() => validateArtifact(other, hash, hash)).toThrow();
  });
  it("rejects inconsistent transforms and coverage", () => {
    const input = fixture();
    input.pages[0]!.transform.visible_to_pdf = [2, 0, 0, 1, 0, 0];
    expect(() => validateArtifact(input, hash, hash)).toThrow();
    input.pages[0]!.transform.visible_to_pdf = [1, 0, 0, 1, 0, 0];
    input.coverage.unreadable_pages = 1;
    expect(() => validateArtifact(input, hash, hash)).toThrow();
  });
  it("rejects page dimensions that cannot display the verified PNG geometry", () => {
    const input = fixture();
    input.pages[0]!.width = 999;
    expect(() => validateArtifact(input, hash, hash)).toThrow();
  });
  it("requires valid identifiers before claiming deliveries", () => {
    expect(() =>
      validateMessage({ schema_version: 1, task_id: "file.sql" }),
    ).toThrow();
  });
});

describe("table grid trust boundary", () => {
  it("accepts merged cells, touching edges, empty cells and incomplete rows", () => {
    const input = tableFixture([
      cell(0, 0, 0, 2),
      cell(1, 0, 1, 1, 3),
      cell(2, 1, 2, 2, 2),
      cell(3, 4, 1),
    ]);
    // OCR pixel boxes may overlap; it is the logical grid that must not overlap.
    expect(validateArtifact(input, hash, hash).pages[0]!.blocks).toHaveLength(
      4,
    );
  });

  it.each([
    ["duplicate coordinates", cell(0, 0, 0), cell(1, 0, 0)],
    ["overlapping row spans", cell(0, 0, 1, 3), cell(1, 2, 1)],
    ["overlapping column spans", cell(0, 2, 0, 1, 3), cell(1, 2, 2)],
    ["contained cell", cell(0, 0, 0, 5, 5), cell(1, 2, 2)],
    ["crossing merged cells", cell(0, 1, 0, 1, 4), cell(1, 0, 2, 3)],
  ])("rejects %s", (_, first, second) => {
    expect(() =>
      validateArtifact(tableFixture([first, second]), hash, hash),
    ).toThrow("parser_invalid_result");
  });

  it.each(["row", "column"] as const)("rejects unsafe %s endpoints", (axis) => {
    const large = cell(0, 0, 0);
    large[axis] = Number.MAX_SAFE_INTEGER;
    expect(() => validateArtifact(tableFixture([large]), hash, hash)).toThrow(
      "parser_invalid_result",
    );
  });

  it("does not expand large sparse spans into grid positions", () => {
    const input = tableFixture([
      cell(0, 1_000_000_000, 1_000_000_000, 1_000_000_000, 1_000_000_000),
      cell(1, 2_000_000_000, 1_000_000_000),
    ]);
    expect(validateArtifact(input, hash, hash).pages[0]!.blocks).toHaveLength(
      2,
    );
  });

  it("scopes grids by table and physical page while requiring unique block IDs", () => {
    const input = tableFixture([cell(0, 0, 0), cell(1, 0, 0, 1, 1, "table-2")]);
    const secondPage = {
      ...input.pages[0]!,
      page_number: 2,
      image_key: randomUUID(),
      blocks: [{ ...cell(0, 0, 0), id: "p2:cell-0" }],
    };
    input.pages.push(secondPage);
    input.coverage.total_pages = 2;
    input.coverage.readable_pages = 2;
    expect(validateArtifact(input, hash, hash).pages).toHaveLength(2);
    secondPage.blocks[0]!.id = "p1:cell-0";
    expect(() => validateArtifact(input, hash, hash)).toThrow(
      "parser_invalid_result",
    );
  });

  it("keeps legacy DOCX paragraph fragments readable without admitting them as a new result", async () => {
    const original = tableFixture([cell(0, 0, 0), cell(1, 0, 0)]);
    const input = {
      ...original,
      pages: [
        {
          ...original.pages[0]!,
          transform: {
            ...original.pages[0]!.transform,
            structural_mapping: true,
            font_sha256: hash,
            layout: "semantic-structure-v1",
          },
          blocks: original.pages[0]!.blocks.map((block, index) => ({
            ...block,
            source: "structured",
            raw_text: `Абзац ${index + 1}`,
            normalized_text: `Абзац ${index + 1}`,
            structural_path: `/document/table[1]/row[1]/cell[1]/p[${index + 1}]`,
          })),
        },
      ],
    };
    expect(
      validateArtifact(input, hash, hash, "stored").pages[0]!.blocks,
    ).toHaveLength(2);
    expect(() => validateArtifact(input, hash, hash)).toThrow(
      "parser_invalid_result",
    );
    const bytes = Buffer.from(JSON.stringify(input));
    const digest = createHash("sha256").update(bytes).digest("hex");
    const artifacts = new ArtifactStorageService(
      new PrivateStorageService(new ConfigService()),
    );
    vi.spyOn(artifacts, "readBytes").mockResolvedValue(bytes);
    await expect(
      artifacts.read(randomUUID(), digest, hash, hash, "stored"),
    ).resolves.toMatchObject({ pages: [{ blocks: input.pages[0]!.blocks }] });
    // Cache reads use the strict default, even for an intact historical file.
    await expect(
      artifacts.read(randomUUID(), digest, hash, hash),
    ).rejects.toThrow("parser_invalid_result");
    await expect(
      artifacts.read(randomUUID(), "b".repeat(64), hash, hash, "stored"),
    ).rejects.toThrow("artifact_integrity_failed");
    input.pages[0]!.blocks[1]!.bbox = [0, 0, 2, 1];
    expect(() => validateArtifact(input, hash, hash, "stored")).toThrow(
      "parser_invalid_result",
    );
  });

  it("matches pairwise rectangle intersection for deterministic mixed spans", () => {
    let seed = 937;
    const next = (limit: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % limit;
    };
    for (let sample = 0; sample < 150; sample++) {
      const cells = Array.from({ length: 7 }, (_, index) =>
        cell(index, next(12), next(12), next(3) + 1, next(3) + 1),
      );
      const overlap = cells.some((left, index) =>
        cells
          .slice(index + 1)
          .some(
            (right) =>
              left.row! < right.row! + right.row_span! &&
              right.row! < left.row! + left.row_span! &&
              left.column! < right.column! + right.column_span! &&
              right.column! < left.column! + left.column_span!,
          ),
      );
      const validate = () => validateArtifact(tableFixture(cells), hash, hash);
      if (overlap) expect(validate).toThrow("parser_invalid_result");
      else expect(validate).not.toThrow();
    }
  });
});
