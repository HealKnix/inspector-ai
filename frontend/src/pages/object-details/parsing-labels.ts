import type { ParsingFile } from "@/api/types/parsing";

export const parsingStateLabels: Record<ParsingFile["state"], string> = {
  queued: "Ожидает обработки",
  processing: "Чтение документа",
  succeeded: "Обработка завершена",
  failed: "Техническая ошибка",
};

export const qualityLabels = {
  OK: "Текст извлечён",
  LOW_QUALITY: "Низкое качество распознавания",
  ABSTAIN: "Не удалось уверенно распознать",
} as const;

const errorLabels: Record<string, string> = {
  parser_timeout: "Превышено время обработки файла.",
  parser_unavailable: "Сервис обработки временно недоступен.",
  parser_invalid_result: "Не удалось проверить результат обработки.",
  original_integrity_failed: "Нарушена целостность оригинала.",
  worker_lease_expired: "Обработка прервана. Результат не был сохранён.",
  source_unavailable: "Исходный файл недоступен.",
  parser_resource_limit: "Для обработки документа недостаточно ресурсов.",
  parser_failed: "Не удалось обработать документ.",
  parser_failure: "Не удалось обработать документ.",
  parser_worker_exit: "Обработка файла прервана.",
  parser_cancelled: "Обработка файла остановлена.",
  parser_busy: "Сервис обработки занят.",
  models_not_ready: "Сервис распознавания ещё не готов.",
  models_not_ready_timeout:
    "Модели распознавания не удалось подготовить вовремя. Обработка остановлена.",
  source_or_storage_unavailable:
    "Не удалось прочитать файл или сохранить результат.",
  source_not_found: "Исходный файл не найден.",
  source_hash_mismatch:
    "Содержимое оригинала не соответствует сохранённой версии.",
  artifact_integrity_failed: "Нарушена целостность результата обработки.",
  invalid_pdf: "Не удалось прочитать структуру PDF.",
  pdf_encrypted: "PDF защищён паролем.",
  invalid_docx: "Не удалось прочитать структуру DOCX.",
  invalid_xml: "Не удалось прочитать структуру XML.",
  xml_dtd_forbidden: "Документ содержит неподдерживаемые объявления XML.",
  page_limit: "В документе слишком много страниц для одной обработки.",
  render_pixel_limit: "Размер страницы превышает допустимый предел.",
  block_limit: "Объём фрагментов превышает допустимый предел.",
  output_size_limit: "Объём результата превышает допустимый предел.",
  resource_limit: "Для обработки документа недостаточно ресурсов.",
  stale_run: "Комплект документов изменился.",
};

export function parsingFailureLabel(code: string | null) {
  return code && errorLabels[code]
    ? errorLabels[code]
    : "Не удалось обработать документ. Причина требует проверки.";
}

const reasonLabels: Record<string, string> = {
  OCR_UNVERIFIED: "Распознанный текст требует проверки",
  OCR_LOW_CONFIDENCE: "Есть неуверенно распознанные фрагменты",
  OCR_DETECTION_WITHOUT_TEXT:
    "Найдены области текста, которые не удалось прочитать",
  OCR_ORIENTATION_AMBIGUOUS: "Ориентация текста определена неоднозначно",
  OCR_GEOMETRY_UNAVAILABLE:
    "Текст сохранён, но его точное положение не определено; выделена вся область распознавания",
  RASTER_REGIONS_REQUIRE_REVIEW: "Области изображения требуют проверки",
  VECTOR_REGIONS_REQUIRE_REVIEW: "Векторные области документа требуют проверки",
  RASTER_SMALL_REGION_UNREADABLE:
    "Мелкие области изображения требуют ручной проверки",
  NATIVE_TEXT_ENCODING: "Текстовый слой содержит ошибки кодировки",
  NO_READABLE_TEXT: "Читаемый текст не найден",
  RENDER_RESOLUTION_LIMITED: "Разрешение отображения ограничено",
  TABLE_GEOMETRY_UNVERIFIED: "Расположение ячеек таблицы требует проверки",
  TABLE_STRUCTURE_UNVERIFIED: "Структура таблиц требует проверки по оригиналу",
  TABLE_STRUCTURE_REJECTED:
    "Структуру таблицы не удалось восстановить надёжно; распознанный текст сохранён",
  OCR_TABLE_TEXT_DIFFERENCE:
    "Текст ячеек отличается от общего распознавания; сравните оба варианта с оригиналом",
  BORDERLESS_TABLES_UNSUPPORTED:
    "Таблицы без границ могут быть распознаны не полностью",
  DOCX_SEMANTIC_RENDER:
    "Показано содержимое DOCX; оформление и разбивка на страницы могут отличаться от оригинала",
  DOCX_EMBEDDED_MEDIA_UNSUPPORTED: "Встроенные изображения DOCX не обработаны",
  DOCX_EMBEDDED_IMAGE_RENDER:
    "Встроенное изображение DOCX показано на отдельной странице",
  DOCX_EXTERNAL_MEDIA_UNAVAILABLE:
    "Изображение по внешней ссылке недоступно для обработки",
  DOCX_MULTIFRAME_MEDIA_UNSUPPORTED:
    "Многокадровое изображение DOCX поддерживается не полностью",
  DOCX_UNREFERENCED_MEDIA:
    "В DOCX есть изображения без ссылки из содержимого документа",
  DOCX_UNSUPPORTED_CONTENT: "Часть содержимого DOCX не поддерживается",
  DOCX_TRACKED_CHANGES:
    "Правки DOCX сохранены отдельными фрагментами и требуют проверки",
  DOCX_FIELD_INSTRUCTIONS:
    "Код поля DOCX сохранён отдельно от отображаемого значения",
  XML_SEMANTIC_RENDER: "Показано читаемое представление структуры XML",
  no_text: "Текст на странице не найден",
  empty_page: "Пустая страница",
  low_confidence: "Распознавание содержит неуверенные фрагменты",
  unreadable: "Есть нечитаемые области",
  handwriting: "Есть рукописные области",
  unsupported_layout: "Разметка поддерживается не полностью",
};

export function textBlockLabel(block: {
  kind: string;
  source: string;
  structural_path: string | null;
}) {
  if (block.kind === "table_cell") return "Ячейка таблицы";
  if (block.source !== "ocr") return null;
  if (block.structural_path?.includes("/recognition-text"))
    return "Вариант текста области таблицы · OCR";
  if (block.structural_path?.includes("/unstructured"))
    return "Текст таблицы без структуры · OCR";
  return "Текст страницы · OCR";
}

export function qualityReasonLabel(reason: string) {
  return (
    reasonLabels[reason] ??
    `Обработчик отметил дополнительное ограничение: ${reason}`
  );
}
