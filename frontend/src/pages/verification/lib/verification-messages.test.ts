import {
  missingContextText,
  verificationReason,
} from "./verification-messages";

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

describe("missingContextText", () => {
  it("translates engine machine codes into inspector-readable reasons", () => {
    expect(missingContextText("block_omitted:sec-1:blk-9")).toBe(
      "Часть материала раздела не была проверена.",
    );
    expect(missingContextText("chunk_omitted:sec-1:3")).toBe(
      "Часть материала раздела не была проверена.",
    );
    expect(missingContextText("discovery_failed:page_limit")).toBe(
      "Раздел найден не полностью.",
    );
    expect(missingContextText("context_blocker:parse_failed")).toBe(
      "Часть контекста раздела недоступна.",
    );
    expect(missingContextText("expansion_unserved:2")).toBe(
      "Часть раздела не вошла в проверку.",
    );
    expect(missingContextText("row_unanswered:P001")).toBe(
      "Ответ по части параметров не получен.",
    );
    expect(missingContextText("discovery_candidates_omitted:4")).toBe(
      "Не все кандидаты раздела проверены.",
    );
  });

  it("shows the human suffix of discovery_missing verbatim", () => {
    expect(
      missingContextText("discovery_missing:раздел 4 не найден в ПД"),
    ).toBe("раздел 4 не найден в ПД");
  });

  it("keeps model-provided free text and masks opaque codes", () => {
    expect(missingContextText("Раздел обрезан лимитом запроса")).toBe(
      "Раздел обрезан лимитом запроса",
    );
    expect(missingContextText("section_cache_miss:9f2e")).toBe(
      "Часть контекста недоступна для анализа.",
    );
  });
});
