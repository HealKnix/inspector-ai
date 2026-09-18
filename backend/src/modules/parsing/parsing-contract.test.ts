import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateArtifact, validateMessage } from "./parsing-contract.js";

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
