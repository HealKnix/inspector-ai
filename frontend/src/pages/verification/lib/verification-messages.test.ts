import { verificationReason } from "./verification-messages";

it("explains missing capability and incomplete evidence without calling documents absent", () => {
  expect(verificationReason("rule_not_approved")).toBe(
    "Проверка этого параметра пока недоступна.",
  );
  expect(verificationReason("evidence_absent")).toBe(
    "Для сравнения не удалось извлечь подтверждённые значения.",
  );
  expect(verificationReason("reference_missing")).toBe(
    "Не удалось определить эталонный документ для сравнения.",
  );
});

it("keeps unknown diagnostic codes out of the inspector interface", () => {
  expect(verificationReason("future_internal_failure:trace123")).toBe(
    "Для продолжения проверки требуется уточнение исходных данных.",
  );
  expect(verificationReason("field_conflict:scope")).toContain(
    "противоречащие",
  );
  expect(verificationReason("unit_mismatch")).toContain("Единицы измерения");
});
