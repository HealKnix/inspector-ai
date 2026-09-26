import type {
  IdentificationDocument,
  IdentificationField,
  IdentificationRegistry,
  IdentificationRevision,
} from "@/api/types/identification";

export const reviewFieldLabels: Partial<Record<IdentificationField, string>> = {
  kind_code: "Вид документа",
  stage: "Стадия документа",
  number: "Номер",
  date: "Дата документа",
  code: "Шифр документа",
  revision_label: "Редакция",
  scope: "Место работ",
  works_from: "Работы с",
  works_to: "Работы по",
  title: "Название документа",
  reference_code: "Ссылка на проектный документ",
  external_id: "Обозначение в исходном документе",
};

export function reviewFields(
  revision: IdentificationRevision,
): IdentificationField[] {
  const fields: IdentificationField[] = ["kind_code"];
  // With no known kind, the stage is the only classification the inspector can
  // explicitly confirm. Keep it visible instead of confirming hidden metadata.
  if (!revision.fields.stage || !revision.fields.kind_code)
    fields.unshift("stage");
  const regular: IdentificationField[] =
    revision.fields.stage === "ID" ||
    (!revision.fields.stage && revision.fields.kind_code === "AOSR")
      ? [...fields, "number", "date", "scope", "works_from", "works_to"]
      : [...fields, "code", "revision_label", "date", "scope"];
  const conflicts = revision.blockers
    .filter((reason) => reason.startsWith("field_conflict:"))
    .map(
      (reason) => reason.slice("field_conflict:".length) as IdentificationField,
    )
    .filter(
      (field) =>
        !["observed_edition", "observed_status"].includes(field) &&
        field in reviewFieldLabels,
    );
  return [...new Set([...regular, ...conflicts])];
}

export function reviewDocumentName(
  document: IdentificationDocument,
  filenames: Map<string, string>,
  revision = document.revisions[0],
) {
  if (!revision) return "Документ";
  const fields = revision.fields;
  const title =
    fields.title ||
    (fields.kind_code === "AOSR"
      ? "Акт освидетельствования скрытых работ"
      : undefined);
  const filename = revision.representations
    .map((item) => filenames.get(item.file_id))
    .find(Boolean);
  let name = title || fields.code || filename || "Документ без названия";
  if (fields.number && !name.includes(fields.number))
    name += ` № ${fields.number}`;
  if (fields.date) name += ` от ${fields.date.split("-").reverse().join(".")}`;
  return name;
}

export function revisionContext(
  registry: IdentificationRegistry,
  revision: IdentificationRevision,
) {
  return registry.contexts.find(
    (context) => context.actual.revision_id === revision.revision_id,
  );
}

export function referenceOptions(
  registry: IdentificationRegistry,
  revision: IdentificationRevision,
  filenames: Map<string, string>,
) {
  const stage =
    revision.fields.stage === "ID"
      ? "RD"
      : revision.fields.stage === "RD"
        ? "PD"
        : null;
  const normalize = (value?: string) =>
    value?.trim().toLocaleLowerCase("ru-RU");
  return registry.documents.flatMap((document) =>
    document.revisions
      .filter(
        (candidate) =>
          candidate.revision_id !== revision.revision_id &&
          candidate.fields.stage === stage &&
          Boolean(revision.fields.scope) &&
          normalize(candidate.fields.scope) ===
            normalize(revision.fields.scope) &&
          (!revision.fields.reference_code ||
            normalize(candidate.fields.code) ===
              normalize(revision.fields.reference_code)) &&
          candidate.approval.confirmed &&
          candidate.approval.effective_from &&
          (!revision.fields.works_from ||
            candidate.approval.effective_from <= revision.fields.works_from) &&
          (!revision.fields.works_to ||
            !candidate.approval.effective_to ||
            candidate.approval.effective_to >= revision.fields.works_to) &&
          !candidate.blockers.some(
            (reason) =>
              reason.startsWith("unsupported_") ||
              reason.startsWith("field_conflict:"),
          ),
      )
      .map((candidate) => ({
        id: candidate.revision_id,
        label: `${reviewDocumentName(document, filenames, candidate)}${candidate.fields.revision_label ? ` · редакция ${candidate.fields.revision_label}` : ""}`,
      })),
  );
}

export type ReviewQuestion = {
  kind: "restriction" | "field" | "reference" | "approval" | "reference-review";
  text: string;
};
export function nextReviewQuestion(
  registry: IdentificationRegistry,
  revision: IdentificationRevision,
): ReviewQuestion | null {
  const context = revisionContext(registry, revision);
  const reasons = [...revision.blockers, ...(context?.blockers ?? [])];
  if (reasons.includes("unsupported_partial_replacement"))
    return {
      kind: "restriction",
      text: "В файле заменены отдельные листы. Проверка реквизитов не определяет состав действующей редакции; такой комплект пока нельзя сравнить автоматически.",
    };
  if (reasons.includes("unsupported_mixed_document"))
    return {
      kind: "restriction",
      text: "В файле обнаружено несколько документов. Уточнение реквизитов не разделит их; для сравнения нужны отдельные документы.",
    };
  if (
    reasons.some(
      (reason) =>
        reason.startsWith("unsupported_") ||
        reason === "source_unreadable" ||
        reason === "source_integrity_mismatch",
    )
  )
    return {
      kind: "restriction",
      text: "Этот источник пока не удалось подготовить для сравнения. Реквизиты можно уточнить по оригиналу, но ограничение обработки сохранится.",
    };
  const conflicting = reasons.find((reason) =>
    reason.startsWith("field_conflict:"),
  );
  if (conflicting)
    return {
      kind: "field",
      text: `Какое значение верно для поля «${reviewFieldLabels[conflicting.slice(15) as IdentificationField] ?? "реквизит"}»? Сверьте его с документом слева.`,
    };
  if (!revision.fields.scope)
    return {
      kind: "field",
      text:
        revision.fields.stage === "ID"
          ? "Где выполнены работы? Укажите место из документа, чтобы связать его с проектными решениями."
          : "К какой части объекта относится документ? Укажите область применения из оригинала.",
    };
  if (
    revision.fields.stage === "ID" &&
    (!revision.fields.works_from || !revision.fields.works_to)
  )
    return {
      kind: "field",
      text: "За какой период выполнены работы? Укажите даты из документа.",
    };
  if (reasons.includes("reference_ambiguous"))
    return {
      kind: "reference",
      text: "Подходят несколько редакций. Какая из них относится к этим работам?",
    };
  const neededAsReference = registry.contexts.some(
    (item) =>
      item.reference?.revision_id === revision.revision_id ||
      (item.blockers.some(
        (reason) =>
          reason.includes("reference_approval") ||
          reason.includes("reference_applicability"),
      ) &&
        registry.documents.some((document) =>
          document.revisions.some(
            (actual) =>
              actual.revision_id === item.actual.revision_id &&
              actual.fields.reference_code === revision.fields.code,
          ),
        )),
  );
  if (
    reasons.includes("actual_approval_unconfirmed") ||
    (neededAsReference &&
      (!revision.approval.confirmed || !revision.approval.effective_from))
  )
    return {
      kind: "approval",
      text: "Есть ли основание считать эту редакцию утверждённой для указанных работ? Это отдельное решение, подтверждение реквизитов его не заменяет.",
    };
  if (reasons.some((reason) => reason.startsWith("reference_")))
    return {
      kind: "reference-review",
      text: "Связь с проектным документом ещё требует проверки. После сохранения реквизитов система повторит подбор; при необходимости проверьте карточку РД.",
    };
  return null;
}
