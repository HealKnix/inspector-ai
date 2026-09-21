import type { ExtractionItem } from "@/api/types/extraction";

export const extractionStatusLabels: Record<ExtractionItem["status"], string> =
  {
    extracted: "Значение извлечено",
    ambiguous: "Несколько равноправных значений",
    no_evidence: "Доказательств не найдено",
    unreadable: "Документ нечитаем",
    unsupported: "Правило не поддерживается",
  };

export const extractionStageLabels = { PD: "ПД", RD: "РД", ID: "ИД" } as const;

export const verdictStatusLabels: Record<
  import("@/api/types/extraction").VerdictStatus,
  string
> = {
  match: "Совпадает",
  discrepancy: "Расхождение",
  expected_missing: "Нет значения в ПД",
  actual_missing: "Источник РД/ИД не передан",
  expected_ambiguous: "Конфликт внутри ПД",
  actual_ambiguous: "Конфликт внутри РД/ИД",
  not_comparable: "Нельзя сравнить",
  no_comparison: "Сравнение не настроено",
};

export const verdictWarningLabels: Record<string, string> = {
  unclassified_members: "есть документы без определённой стадии",
  unit_missing: "единицы измерения не указаны у одной из сторон",
};
