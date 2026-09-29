import type {
  IdentificationField,
  IdentificationRegistry,
} from "@/api/types/identification";

export const identificationFieldLabels: Record<IdentificationField, string> = {
  stage: "Стадия",
  kind_code: "Вид документа",
  title: "Название",
  number: "Собственный номер",
  date: "Собственная дата",
  code: "Собственный шифр",
  scope: "Область работ",
  works_from: "Работы с",
  works_to: "Работы по",
  revision_label: "Обозначение редакции",
  reference_code: "Ссылка на РД",
  external_id: "Идентификатор XML",
  observed_edition: "Edition из источника",
  observed_status: "Статус из источника",
  observed_replaced_sheet: "Лист в перечне замены (требует подтверждения)",
};
export function identificationCanApply(registry: IdentificationRegistry) {
  return (
    registry.current &&
    registry.run_id === registry.current_run_id &&
    !registry.active &&
    registry.allowed_actions.apply &&
    !["PARSING", "FINALIZED"].includes(registry.process_status)
  );
}
