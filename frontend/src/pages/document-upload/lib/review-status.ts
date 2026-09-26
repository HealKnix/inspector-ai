export function sourceIssueMessage(reasons: readonly string[]) {
  if (reasons.includes("unsupported_partial_replacement"))
    return "Заменены отдельные листы. Нужен полный документ.";
  if (
    reasons.includes("unsupported_mixed_document") ||
    reasons.includes("possible_mixed_document")
  )
    return "Проверьте, что в файле один документ.";
  if (reasons.includes("source_integrity_mismatch"))
    return "Оригинал недоступен. Загрузите документ повторно.";
  if (
    reasons.some((reason) =>
      ["partial_parse_requires_review", "source_unreadable"].includes(reason),
    )
  )
    return "Часть файла не прочитана. Проверьте оригинал.";
  return reasons.length
    ? "Проверьте исходный файл в карточке документа."
    : null;
}

export function metadataIssueMessage(reasons: readonly string[]) {
  if (reasons.some((reason) => reason.includes("conflict")))
    return "Сверьте сведения с оригиналом.";
  return "Подтвердите сведения в карточке документа.";
}
