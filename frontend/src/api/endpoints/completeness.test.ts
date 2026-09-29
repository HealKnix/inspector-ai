import {
  confirmExpectedPackage,
  evaluateCompleteness,
  generateExpectedPackage,
  getCompletenessResult,
  getExpectedPackage,
} from "./completeness";

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/api/client", () => ({ apiClient: { get, post } }));
beforeEach(() => vi.resetAllMocks());

const objectId = "88888888-8888-4888-8888-888888888888";

const requirement = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "PD-PZ",
  stage: "PD",
  kind_code: "ПЗ",
  title: "Пояснительная записка",
  scope: null,
  quantity: { min: 1, per: "object" },
  alternatives: null,
  origin: "framework",
  excluded: false,
  exclusion_reason: null,
  source: { norm_ref: "ТЗ §3 п.1", framework_code: "PD-PZ" },
};

const packageResponse = {
  schema_version: 1,
  object_id: objectId,
  package: {
    version: 2,
    status: "proposed",
    framework_version: 1,
    attributes: { demolition: true },
    confirmed_by: null,
    confirmed_at: null,
    basis: null,
    list_items: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        list_kind: "hidden_works",
        item_key: "сваи",
        title: "Устройство свай",
        source: { file_id: objectId, page: 3, quote: "перечень скрытых" },
      },
    ],
    requirements: [requirement],
    requirements_total: 1,
  },
  package_absent_reason: null,
};

const resultResponse = {
  schema_version: 1,
  object_id: objectId,
  process_id: "33333333-3333-4333-8333-333333333333",
  run_id: "44444444-4444-4444-8444-444444444444",
  package_version: 2,
  framework_version: 1,
  evaluated_at: "2026-09-20T15:00:00.000Z",
  evaluation: {
    stages: {
      PD: {
        status: "MISSING",
        applicable: 1,
        fulfilled: 0,
        missing: 1,
        unverifiable: 0,
      },
      RD: null,
      ID: null,
    },
    scenario: "PARTIALLY_LOADED",
    requirements: [
      {
        requirement_id: requirement.id,
        code: requirement.code,
        title: requirement.title,
        stage: "PD",
        scope: null,
        outcome: "missing",
        reasons: ["required_document_missing"],
        matched: [],
        missing_parts: ["нет документа вида ПЗ"],
      },
    ],
    counts: {
      applicable: 1,
      fulfilled: 0,
      missing: 1,
      unverifiable: 0,
      not_applicable: 0,
    },
  },
  evaluation_absent_reason: null,
};

describe("completeness boundary", () => {
  it("загружает ожидаемый состав и передаёт сигнал отмены", async () => {
    const signal = new AbortController().signal;
    get.mockResolvedValue({ data: packageResponse });
    expect(await getExpectedPackage(objectId, signal)).toEqual(packageResponse);
    expect(get).toHaveBeenCalledWith(
      `/v1/objects/${objectId}/completeness/package`,
      { signal },
    );
  });

  it("принимает отсутствие перечня без выдуманного состава", async () => {
    const absent = {
      ...packageResponse,
      package: null,
      package_absent_reason: "package_not_generated",
    };
    get.mockResolvedValue({ data: absent });
    expect((await getExpectedPackage(objectId)).package).toBeNull();
  });

  it("формирует предложение с атрибутами объекта", async () => {
    post.mockResolvedValue({
      data: {
        schema_version: 1,
        object_id: objectId,
        package_version: 1,
        status: "proposed",
      },
    });
    await generateExpectedPackage({
      objectId,
      attributes: { demolition: true, purpose: "production" },
    });
    expect(post).toHaveBeenCalledWith(
      `/v1/objects/${objectId}/completeness/package/generate`,
      { attributes: { demolition: true, purpose: "production" } },
    );
  });

  it("подтверждает состав с версией, основанием и исключениями", async () => {
    const requestId = "55555555-5555-4555-8555-555555555555";
    post.mockResolvedValue({
      data: { schema_version: 1, object_id: objectId, package_version: 3 },
    });
    await confirmExpectedPackage({
      objectId,
      requestId,
      expectedVersion: 2,
      basis: "Сверено с ПЗ объекта",
      attributes: { demolition: true },
      exclude: [{ requirement_id: requirement.id, reason: "раздел не входит" }],
    });
    expect(post).toHaveBeenCalledWith(
      `/v1/objects/${objectId}/completeness/package/confirm`,
      {
        request_id: requestId,
        expected_version: 2,
        basis: "Сверено с ПЗ объекта",
        attributes: { demolition: true },
        exclude: [
          { requirement_id: requirement.id, reason: "раздел не входит" },
        ],
      },
    );
  });

  it("возвращает результат и запрашивает расчёт по запуску", async () => {
    get.mockResolvedValue({ data: resultResponse });
    expect(await getCompletenessResult(objectId)).toEqual(resultResponse);
    post.mockResolvedValue({ data: resultResponse });
    const evaluated = await evaluateCompleteness({
      objectId,
      runId: resultResponse.run_id,
    });
    expect(evaluated.evaluation?.scenario).toBe("PARTIALLY_LOADED");
    expect(post).toHaveBeenCalledWith(
      `/v1/objects/${objectId}/completeness/evaluate`,
      { run_id: resultResponse.run_id },
    );
  });

  it("принимает nullable-оценку с явной причиной", async () => {
    const absent = {
      ...resultResponse,
      run_id: null,
      evaluated_at: null,
      evaluation: null,
      evaluation_absent_reason: "not_evaluated",
    };
    get.mockResolvedValue({ data: absent });
    const result = await getCompletenessResult(objectId);
    expect(result.evaluation).toBeNull();
    expect(result.evaluation_absent_reason).toBe("not_evaluated");
  });

  it.each([
    { ...packageResponse, schema_version: 2 },
    {
      ...packageResponse,
      package: { ...packageResponse.package, status: "draft" },
    },
    {
      ...resultResponse,
      evaluation: {
        ...resultResponse.evaluation,
        requirements: [
          { ...resultResponse.evaluation.requirements[0], outcome: "ok" },
        ],
      },
    },
  ])("отклоняет несовместимые ответы", async (response) => {
    get.mockResolvedValue({ data: response });
    await expect(getExpectedPackage(objectId)).rejects.toThrow();
  });
});
