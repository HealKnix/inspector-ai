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
