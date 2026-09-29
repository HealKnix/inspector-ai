const reasonLabels: Record<string, string> = {
  rule_not_approved: "Проверка этого параметра пока недоступна.",
  parameter_not_applicable: "Параметр неприменим к выбранному комплекту.",
  stage_unresolved: "Уточните вид документа: ПД, РД или ИД.",
  unclassified_members: "Для части источников не определён вид документа.",
  revision_unresolved: "Применимая редакция документа требует уточнения.",
  scope_unresolved: "Уточните область работ, к которой относится документ.",
  works_period_unresolved: "Уточните период выполнения работ.",
  actual_approval_unconfirmed:
    "Применимость проверяемого документа ещё не подтверждена.",
  reference_approval_unconfirmed:
    "Утверждение эталонного документа ещё не подтверждено.",
  reference_applicability_unconfirmed:
    "Применимость эталонной редакции к этим работам ещё не подтверждена.",
  reference_missing: "Не удалось определить эталонный документ для сравнения.",
  reference_not_in_snapshot: "Выбранный эталон недоступен в этом расчёте.",
  reference_stage_invalid:
    "Вид выбранного эталона не подходит для этого сравнения.",
  reference_scope_mismatch:
    "Области работ проверяемого документа и эталона не совпадают.",
  reference_link_unconfirmed: "Связь с эталонным документом требует уточнения.",
  reference_ambiguous:
    "Для этих работ подходят несколько редакций. Нужен выбор применимой редакции.",
  reference_evidence_unresolved:
    "Реквизиты эталонного документа требуют уточнения.",
  reference_period_overlap:
    "Период работ пересекает несколько редакций эталона.",
  reference_period_or_evidence_unresolved:
    "Период действия или реквизиты эталонной редакции требуют уточнения.",
  replacement_period_conflict:
    "Не удалось однозначно определить редакцию после замены документа.",
  replacement_unconfirmed: "Замена редакции ещё не подтверждена.",
  replacement_target_invalid: "Уточните, какую редакцию заменяет документ.",
  replacement_cycle: "В последовательности замен есть противоречие.",
  replacement_period_invalid:
    "Периоды действия заменяемых редакций противоречат друг другу.",
  unsupported_partial_replacement:
    "Документ содержит частичную замену листов. Автоматическое сравнение пока недоступно.",
  unsupported_mixed_document:
    "В файле обнаружено несколько документов. Нужны отдельные документы для сравнения.",
  unsupported_format: "Этот формат пока не поддерживается для сравнения.",
  unsupported_xml_schema: "Структура XML пока не поддерживается для сравнения.",
  source_unreadable: "Не удалось надёжно прочитать исходный документ.",
  required_document_missing:
    "В комплекте не подтверждён документ, необходимый для этой проверки.",
  evidence_absent: "Для сравнения не удалось извлечь подтверждённые значения.",
  unit_missing: "У одного из значений не определена единица измерения.",
  unit_mismatch: "Единицы измерения сравниваемых значений различаются.",
  type_mismatch: "Извлечённые значения имеют разные типы.",
  non_numeric:
    "Для этой проверки нужно числовое значение; извлечённое значение не удалось сопоставить.",
  section_context_incomplete:
    "Анализу разделов не хватило контекста для вывода.",
  section_fact_missing: "Анализ разделов не вернул факт для этого параметра.",
  section_coverage_incomplete: "Раздел проверен не полностью.",
  section_role_missing:
    "Анализ разделов не получил цитат с обеих сторон сравнения.",
};

export function verificationReason(reason: string): string {
  if (reasonLabels[reason]) return reasonLabels[reason];
  if (reason.startsWith("field_conflict:"))
    return "В реквизитах документа есть противоречащие друг другу значения.";
  if (reason.startsWith("below_min:"))
    return "Значение ниже допустимой границы.";
  if (reason.startsWith("above_max:"))
    return "Значение выше допустимой границы.";
  if (
    reason.startsWith("block_omitted:") ||
    reason.startsWith("chunk_omitted:") ||
    reason.startsWith("discovery_candidates_omitted:")
  )
    return "Часть материала раздела не была проверена.";
  if (reason.startsWith("discovery_failed:"))
    return "Раздел найден не полностью.";
  if (reason.startsWith("context_blocker:"))
    return "Часть контекста раздела недоступна.";
  if (reason.startsWith("expansion_unserved:"))
    return "Часть раздела не вошла в проверку.";
  if (reason.startsWith("row_unanswered:"))
    return "Ответ по части параметров не получен.";
  return "Для продолжения проверки требуется уточнение исходных данных.";
}

const missingContextPrefixes: ReadonlyArray<readonly [string, string]> = [
  ["discovery_failed:", "Раздел найден не полностью."],
  ["context_blocker:", "Часть контекста раздела недоступна."],
  ["expansion_unserved:", "Часть раздела не вошла в проверку."],
  ["row_unanswered:", "Ответ по части параметров не получен."],
  ["block_omitted:", "Часть материала раздела не была проверена."],
  ["chunk_omitted:", "Часть материала раздела не была проверена."],
  ["discovery_candidates_omitted:", "Не все кандидаты раздела проверены."],
];

/**
 * Недостающий контекст анализа разделов: известные машинные коды переводятся
 * в объяснение для инспектора, свободный текст от модели сохраняется как есть.
 */
export function missingContextText(item: string): string {
  // `discovery_missing:<human>` carries an inspector-readable suffix.
  if (item.startsWith("discovery_missing:")) {
    const human = item.slice("discovery_missing:".length).trim();
    return human || "Раздел найден не полностью.";
  }
  for (const [prefix, text] of missingContextPrefixes) {
    if (item.startsWith(prefix)) return text;
  }
  // Opaque `code:value` entries do not explain anything to the inspector.
  if (/^[a-z0-9_.:-]+$/i.test(item))
    return "Часть контекста недоступна для анализа.";
  return item;
}
