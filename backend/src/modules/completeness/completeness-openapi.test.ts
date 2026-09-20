import { Ajv } from "ajv";
import { describe, expect, it } from "vitest";
import {
  completenessResultSchema,
  confirmPackageRequestSchema,
  confirmPackageResponseSchema,
  expectedPackageSchema,
} from "./completeness-openapi.js";

const ajv = new Ajv({ allErrors: true, strict: false });

const objectId = "11111111-1111-4111-8111-111111111111";
const processId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const requirementId = "44444444-4444-4444-8444-444444444444";
const fileId = "55555555-5555-4555-8555-555555555555";

describe("completeness OpenAPI schemas", () => {
  it("принимает неизвестную полноту без выдуманного знаменателя", () => {
    const validate = ajv.compile(expectedPackageSchema);
    const sample = {
      schema_version: 1,
      object_id: objectId,
      package: null,
      package_absent_reason: "package_not_confirmed",
    };
    expect(ajv.errorsText(validate.errors)).toBe("No errors");
    expect(validate(sample)).toBe(true);
  });

  it("принимает результат с nullable-оценкой и причиной", () => {
    const validate = ajv.compile(completenessResultSchema);
    const sample = {
      schema_version: 1,
      object_id: objectId,
      process_id: processId,
      run_id: runId,
      package_version: null,
      framework_version: null,
      evaluated_at: new Date().toISOString(),
      evaluation: null,
      evaluation_absent_reason: "package_not_confirmed",
    };
    expect(validate(sample), ajv.errorsText(validate.errors)).toBe(true);
  });

  it("принимает требование с per-генератором и OR-альтернативами", () => {
    const validate = ajv.compile(expectedPackageSchema);
    const sample = {
      schema_version: 1,
      object_id: objectId,
      package_absent_reason: null,
      package: {
        version: 2,
        status: "confirmed",
        framework_version: 1,
        attributes: { demolition: false, estimate_required: false },
        confirmed_by: objectId,
        confirmed_at: new Date().toISOString(),
        basis: "Состав проекта и перечень скрытых работ проверены",
        requirements_total: 2,
        requirements: [
          {
            id: requirementId,
            code: "ID-AOSR",
            stage: "ID",
            kind_code: "aosr",
            title: "Акт освидетельствования скрытых работ",
            scope: { item: "Буросекущие сваи" },
            quantity: { min: 1, per: "list_item" },
            alternatives: null,
            origin: "extracted",
            excluded: false,
            source: { norm_ref: "Приказ 344/пр, прил.1 п.3", file_id: fileId },
          },
          {
            id: "66666666-6666-4666-8666-666666666666",
            code: "ID-MATERIAL",
            stage: "ID",
            kind_code: "material_quality",
            title: "Документ качества материала",
            scope: { item: "Бетон B25" },
            quantity: { min: 1, per: "list_item" },
            alternatives: ["passport", "certificate"],
            origin: "framework",
            excluded: false,
            source: { norm_ref: "Приказ 344/пр, прил.1 п.12" },
          },
        ],
      },
    };
    expect(validate(sample), ajv.errorsText(validate.errors)).toBe(true);
  });

  it("принимает результат с причинами по каждому требованию", () => {
    const validate = ajv.compile(completenessResultSchema);
    const sample = {
      schema_version: 1,
      object_id: objectId,
      process_id: processId,
      run_id: runId,
      package_version: 2,
      framework_version: 1,
      evaluated_at: new Date().toISOString(),
      evaluation_absent_reason: null,
      evaluation: {
        scenario: "PARTIALLY_LOADED",
        stages: {
          PD: {
            status: "UPLOADED",
            applicable: 5,
            fulfilled: 5,
            missing: 0,
            unverifiable: 0,
          },
          RD: {
            status: "PARTIAL",
            applicable: 8,
            fulfilled: 3,
            missing: 4,
            unverifiable: 1,
          },
          ID: null,
        },
        counts: {
          applicable: 30,
          fulfilled: 20,
          missing: 6,
          unverifiable: 2,
          not_applicable: 2,
        },
        requirements: [
          {
            requirement_id: requirementId,
            code: "ID-AOSR",
            title: "Акт освидетельствования скрытых работ",
            stage: "ID",
            scope: { item: "Стена в грунте" },
            outcome: "unverifiable",
            reasons: ["document_scope_unresolved", "revision_unknown"],
            matched: [{ file_id: fileId }],
            missing_parts: [],
          },
          {
            requirement_id: "77777777-7777-4777-8777-777777777777",
            code: "RD-OV",
            title: "Комплект чертежей ОВ",
            stage: "RD",
            scope: null,
            outcome: "missing",
            reasons: ["no_document_of_kind"],
            matched: [],
            missing_parts: ["whole_document"],
          },
        ],
      },
    };
    expect(validate(sample), ajv.errorsText(validate.errors)).toBe(true);
  });

  it("принимает подтверждение состава с атрибутами и исключением", () => {
    const validate = ajv.compile(confirmPackageRequestSchema);
    const sample = {
      request_id: "88888888-8888-4888-8888-888888888888",
      expected_version: 1,
      basis: "ПОД неприменим: объектов к сносу нет (ПОС, раздел 7)",
      attributes: { demolition: false },
      exclude: [
        {
          requirement_id: requirementId,
          reason: "Работы отсутствуют в составе проекта",
        },
      ],
    };
    expect(validate(sample), ajv.errorsText(validate.errors)).toBe(true);
  });

  it("принимает ответ подтверждения", () => {
    const validate = ajv.compile(confirmPackageResponseSchema);
    const sample = {
      schema_version: 1,
      object_id: objectId,
      package_version: 2,
    };
    expect(validate(sample), ajv.errorsText(validate.errors)).toBe(true);
  });
});
