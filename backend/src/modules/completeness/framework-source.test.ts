import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = resolve(__dirname, "../../../scripts/framework-v1.jsonl");

interface Row {
  kind: string;
  [key: string]: unknown;
}

const rows = readFileSync(SOURCE, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line) as Row);

const vocab = new Map<string, Set<string>>();
for (const row of rows) {
  if (row.kind !== "vocabulary") continue;
  const name = row.vocab as string;
  if (!vocab.has(name)) vocab.set(name, new Set());
  vocab.get(name)?.add(row.code as string);
}

const stageVocabs: Record<string, string[]> = {
  PD: ["pd_section"],
  RD: ["rd_mark", "rd_component"],
  ID: ["id_kind"],
};

describe("источник нормативного каркаса", () => {
  it("содержит meta с областью применения и источниками", () => {
    const meta = rows.find((row) => row.kind === "meta");
    expect(meta?.title).toBeTruthy();
    expect(meta?.scope).toContain("Линейные объекты вне области");
    expect(meta?.sources).toContain("344/пр");
  });

  it("у каждой строки словаря и требования есть нормативное основание", () => {
    for (const row of rows) {
      if (row.kind === "vocabulary" || row.kind === "requirement") {
        expect(row.norm_ref, `${row.kind} ${String(row.code)}`).toBeTruthy();
      }
    }
  });

  it("kind_code каждого требования разрешается в словаре своей стадии", () => {
    for (const row of rows) {
      if (row.kind !== "requirement") continue;
      const stage = row.stage as string;
      const kindCode = row.kind_code as string;
      const ok = (stageVocabs[stage] ?? []).some((v) =>
        vocab.get(v)?.has(kindCode),
      );
      expect(ok, `${String(row.code)}: ${kindCode}`).toBe(true);
    }
  });

  it("генераторы ссылаются на объявленные перечни, а атрибуты — на словарь", () => {
    const listKinds = vocab.get("list_kind") ?? new Set();
    const attrs = vocab.get("object_attribute") ?? new Set();
    const checkApplicability = (node: unknown) => {
      if (typeof node !== "object" || node === null) return;
      const record = node as Record<string, unknown>;
      if (typeof record.attr === "string")
        expect(attrs.has(record.attr), `attr ${record.attr}`).toBe(true);
      for (const key of ["all", "any"]) {
        if (Array.isArray(record[key]))
          for (const child of record[key]) checkApplicability(child);
      }
    };
    for (const row of rows) {
      if (row.kind !== "requirement") continue;
      const quantity = row.quantity as { min?: number; per?: string };
      expect(quantity?.min, `${String(row.code)} quantity.min`).toBeTypeOf(
        "number",
      );
      if (quantity.per)
        expect(listKinds.has(quantity.per), `${String(row.code)} per`).toBe(
          true,
        );
      checkApplicability(row.applicability);
    }
  });

  it("операторы хранятся явно: «;» в исходных строках не становится структурой", () => {
    for (const row of rows) {
      if (row.kind !== "requirement") continue;
      // quantity/alternatives/applicability — структурные поля, не текст.
      for (const field of ["quantity", "alternatives", "applicability"]) {
        expect(typeof row[field], `${String(row.code)}.${field}`).not.toBe(
          "string",
        );
      }
    }
  });

  it("каждое соответствие §6 ссылается на код словаря или хранит исходный текст", () => {
    const allCodes = new Map<string, Set<string>>();
    for (const [name, codes] of vocab) allCodes.set(name, codes);
    for (const row of rows) {
      if (row.kind !== "mapping") continue;
      expect(
        vocab.get("matrix_section")?.has(row.matrix_section as string),
      ).toBe(true);
      const stage = row.stage as string;
      if (row.code === null) {
        expect(
          row.source_text,
          `mapping ${String(row.matrix_section)}`,
        ).toBeTruthy();
      } else {
        const ok = (stageVocabs[stage] ?? []).some((v) =>
          vocab.get(v)?.has(row.code as string),
        );
        expect(ok, `mapping ${String(row.matrix_section)}/${stage}`).toBe(true);
      }
    }
  });
});
