import type { PageRegion } from "@/api/types/parsing";
export const regionKindLabels: Record<PageRegion["kind"], string> = {
  text: "Текст",
  table: "Таблица",
  graphic: "Графическая область",
  unknown: "Неопределённая область",
};
export const methodLabels: Record<PageRegion["method"], string> = {
  native: "Текстовый слой · без OCR",
  ocr: "OCR области",
  hybrid: "Текстовый слой и OCR непокрытых строк",
  native_table: "Таблица из текстового слоя · без OCR",
  table_ocr: "Распознавание таблицы",
  skipped: "OCR не выполнялся",
};
