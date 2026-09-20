export const stageLabels: Record<string, string> = {
  PD: "Проектная",
  RD: "Рабочая",
  ID: "Исполнительная",
};

export const stageStatusLabels: Record<string, string> = {
  UPLOADED: "Загружена полностью",
  PARTIAL: "Загружена частично",
  MISSING: "Не загружена",
};

export const scenarioLabels: Record<string, string> = {
  FULL: "Комплект полный",
  PD_RD_ONLY: "Загружены только ПД и РД",
  PD_ID_ONLY: "Загружены только ПД и ИД",
  RD_ID_ONLY: "Загружены только РД и ИД",
  SINGLE_ONLY: "Загружена одна стадия",
  PARTIALLY_LOADED: "Комплект загружен частично",
};

export const outcomeLabels: Record<string, string> = {
  fulfilled: "Закрыто",
  missing: "Отсутствует",
  not_applicable: "Не применимо",
  unverifiable: "Требует уточнения",
};

export const reasonLabels: Record<string, string> = {
  kind_unresolved: "вид документа не разрешён",
  kind_ambiguous: "вид документа неоднозначен",
  kind_needs_review: "вид требует проверки инспектором",
  scope_unresolved: "область работ документа не разрешена",
  stage_unresolved: "стадия документа не разрешена",
  required_document_missing: "обязательный документ отсутствует",
  evidence_absent: "доказательства не загружены",
};

export const listKindLabels: Record<string, string> = {
  hidden_works: "Скрытые работы",
  structures: "Конструкции",
  network_sections: "Участки сетей",
  rd_marks: "Марки рабочей документации",
};

export function outcomeReasonLabel(reason: string) {
  return reasonLabels[reason] ?? reason;
}
