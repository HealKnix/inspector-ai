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
  composite_context_missing:
    "Не зафиксирован общий контекст документов и редакций.",
  composite_context_invalid: "Контекст источников не прошёл проверку.",
  composite_applicability_basis_missing:
    "Нет подтверждённого основания применимости.",
  composite_applicability_unknown: "Применимость условия ещё не подтверждена.",
  composite_applicability_not_applicable:
    "Условие неприменимо в выбранной области.",
  composite_member_role_unknown: "Не определена роль источника в сравнении.",
  composite_member_context_missing:
    "Для источника не подтверждены область и период.",
  composite_member_context_mismatch:
    "Источники относятся к разным областям или периодам.",
  composite_revision_mismatch:
    "Редакция источника не соответствует выбранному снимку.",
  composite_branch_unknown:
    "Для общего вывода недостаточно данных одной или нескольких ветвей.",
  unclassified_members: "есть документы без определённой стадии",
  unit_missing: "единицы измерения не указаны у одной из сторон",
};
