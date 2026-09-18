import { ConfigService } from "@nestjs/config";
import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PrivateStorageService } from "../../infrastructure/storage/private-storage.service.js";
import { ArtifactStorageService } from "./artifact-storage.service.js";
import {
  validateArtifact,
  validateMessage,
  type ParseBlock,
} from "./parsing-contract.js";

const hash = "a".repeat(64);
function fixture() {
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
