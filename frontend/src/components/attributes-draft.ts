export const BOOLEAN_ATTRIBUTES: { key: string; label: string }[] = [
  { key: "demolition", label: "Есть снос или демонтаж" },
  { key: "estimate_required", label: "Требуется смета" },
  { key: "calc_included", label: "Смета включена в состав" },
  { key: "tx_required", label: "Требуются технические условия" },
  { key: "budget_funded", label: "Бюджетное финансирование" },
  { key: "other_docs_required", label: "Требуются прочие документы" },
  { key: "remarks_issued", label: "Выданы замечания" },
];

export interface AttributesDraft {
  booleans: Record<string, boolean>;
  purpose: string;
  engineering_systems: string;
}

export function emptyAttributesDraft(): AttributesDraft {
  return { booleans: {}, purpose: "", engineering_systems: "" };
}

export function draftFromAttributes(
  attributes: Record<string, unknown>,
): AttributesDraft {
  const booleans: Record<string, boolean> = {};
  for (const { key } of BOOLEAN_ATTRIBUTES)
    booleans[key] = attributes[key] === true;
  return {
    booleans,
    purpose:
      typeof attributes["purpose"] === "string" ? attributes["purpose"] : "",
    engineering_systems: Array.isArray(attributes["engineering_systems"])
      ? (attributes["engineering_systems"] as string[]).join(", ")
      : "",
  };
}

export function draftToAttributes(draft: AttributesDraft) {
  const attributes: Record<string, unknown> = { ...draft.booleans };
  if (draft.purpose) attributes["purpose"] = draft.purpose;
  const systems = draft.engineering_systems
    .split(",")
    .map((system) => system.trim())
    .filter(Boolean);
  if (systems.length > 0) attributes["engineering_systems"] = systems;
  return attributes;
}
