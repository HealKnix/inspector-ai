export const classificationStageLabels = {
  PD: "ПД — проектная документация",
  RD: "РД — рабочая документация",
  ID: "ИД — исполнительная документация",
};

export const classificationStateLabels = {
  queued: "Ожидает классификации",
  processing: "Определяем принадлежность",
  succeeded: "Классификация выполнена",
  failed: "Классификация не выполнена",
};

export function classificationFailureLabel(code: string | null) {
  switch (code) {
    case "classification_llm_disabled":
      return "Модель классификации не настроена.";
    case "classification_llm_timeout":
      return "Модель не ответила вовремя.";
    case "classification_llm_invalid_result":
    case "classification_llm_citation_mismatch":
    case "classification_llm_response_too_large":
      return "Ответ модели не прошёл проверку.";
    default:
      return "Не удалось классифицировать документ. Сохранённый результат чтения доступен.";
  }
}

export function classificationReasonLabel(code: string) {
  switch (code) {
    case "conflicting_own_evidence":
      return "Обнаружены противоречащие признаки принадлежности.";
    case "no_reliable_own_evidence":
    case "llm_insufficient_evidence":
      return "Недостаточно надёжных признаков принадлежности.";
    case "llm_requires_review":
      return "Предложение модели требует проверки.";
    case "possible_mixed_document":
      return "Файл может содержать документы разной принадлежности.";
    case "partial_parse_requires_review":
      return "Часть документа не прочитана; результат требует проверки.";
    case "llm_disabled":
      return "Модель классификации не настроена.";
    case "no_classification_fragments":
      return "Не найдены фрагменты для определения принадлежности.";
    case "bounded_context":
      return "Для классификации использована часть извлечённых фрагментов.";
    case "xml_own_aosr_name":
      return "В структуре XML указан акт освидетельствования скрытых работ.";
    case "xml_own_as_built_schema":
      return "В структуре XML указана исполнительная схема.";
    case "own_document_title":
      return "Принадлежность указана в заголовке документа.";
    case "own_stage_cell":
      return "Стадия указана в основной надписи документа.";
    default:
      return "Автоматический результат требует проверки по исходному документу.";
  }
}
