import type { OpenAPIObject } from "@nestjs/swagger";
type SchemaObject = NonNullable<
  NonNullable<OpenAPIObject["components"]>["schemas"]
>[string];

const uuid = { type: "string", format: "uuid" } satisfies SchemaObject;
const stage = {
  type: "string",
  enum: ["PD", "RD", "ID"],
} satisfies SchemaObject;

const scope: SchemaObject = {
  type: "object",
  nullable: true,
  description:
    "Область работ требования: элемент перечня (вид скрытых работ, сеть, " +
    "раздел), оси/отметки при наличии; null — требование на весь объект",
  additionalProperties: false,
  properties: {
    item: { type: "string", description: "Элемент объектного перечня" },
    axes: { type: "string", description: "Оси/отметки/участок" },
  },
};

const quantity: SchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["min", "per"],
  properties: {
    min: { type: "integer", minimum: 0 },
    per: {
      type: "string",
      enum: ["object", "list_item"],
      description:
        "object — одно на объект; list_item — на каждый элемент объектного перечня",
    },
  },
};

const alternatives: SchemaObject = {
  type: "array",
  nullable: true,
  description:
    "Допустимые альтернативы (OR-группа кодов видов); исходный разделитель " +
    "«;» из Матрицы оператором не является — сюда попадают только проверенные",
  items: { type: "string" },
};

const requirementSource: SchemaObject = {
  type: "object",
  nullable: true,
  description: "Источник предложения требования: норма каркаса или evidence",
  additionalProperties: false,
  properties: {
    norm_ref: { type: "string" },
    file_id: uuid,
    locator: { type: "string" },
  },
};

const packageRequirement: SchemaObject = {
  type: "object",
  additionalProperties: false,
  required: [
    "id",
    "code",
    "stage",
    "kind_code",
    "title",
    "scope",
    "quantity",
    "alternatives",
    "origin",
    "excluded",
    "source",
  ],
  properties: {
    id: uuid,
    code: { type: "string", description: "Стабильный код требования" },
    stage,
    kind_code: {
      type: "string",
      description: "Код вида/раздела из словаря каркаса",
    },
    title: { type: "string" },
    scope,
    quantity,
    alternatives,
    origin: {
      type: "string",
      enum: ["framework", "extracted", "manual"],
    },
    excluded: {
      type: "boolean",
      description: "Инспектор снял требование при подтверждении",
    },
    exclusion_reason: { type: "string", nullable: true },
    source: requirementSource,
  },
};

const attributes: SchemaObject = {
  type: "object",
  description:
    "Подтверждённые атрибуты объекта, управляющие применимостью " +
    "(например demolition=false отключает требования ПОД)",
  additionalProperties: {
    anyOf: [{ type: "boolean" }, { type: "string" }, { type: "number" }],
  },
};

export const expectedPackageSchema: SchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "object_id", "package", "package_absent_reason"],
  properties: {
    schema_version: { type: "integer", enum: [1] },
    object_id: uuid,
    package: {
      type: "object",
      nullable: true,
      additionalProperties: false,
      required: [
        "version",
        "status",
        "framework_version",
        "attributes",
        "confirmed_by",
        "confirmed_at",
        "basis",
        "requirements",
        "requirements_total",
      ],
      properties: {
        version: { type: "integer", minimum: 1 },
        status: { type: "string", enum: ["proposed", "confirmed"] },
        framework_version: { type: "integer", minimum: 1 },
        attributes,
        confirmed_by: uuid,
        confirmed_at: { type: "string", format: "date-time", nullable: true },
        basis: { type: "string", nullable: true },
        requirements: { type: "array", items: packageRequirement },
        requirements_total: {
          type: "integer",
          minimum: 0,
          description:
            "Полный применимый состав; не зависит от пагинации ответа",
        },
      },
    },
    package_absent_reason: {
      type: "string",
      nullable: true,
      description: "Причина отсутствия перечня; null при наличии package",
    },
  },
};

export const confirmPackageRequestSchema: SchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["request_id", "expected_version", "basis", "attributes"],
  properties: {
    request_id: {
      ...uuid,
      description: "Идемпотентный ключ подтверждения",
    },
    expected_version: {
      type: "integer",
      minimum: 1,
      description:
        "Версия перечня, которую видел инспектор; несовпадение — 409",
    },
    basis: {
      type: "string",
      minLength: 1,
      description: "Основание подтверждения состава",
    },
    attributes: {
      ...attributes,
      description: "Значения атрибутов объекта, фиксируемые в версии",
    },
    exclude: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["requirement_id", "reason"],
        properties: {
          requirement_id: uuid,
          reason: { type: "string", minLength: 1 },
        },
      },
    },
    include: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["stage", "kind_code", "title", "quantity"],
        properties: {
          stage,
          kind_code: { type: "string" },
          title: { type: "string" },
          scope,
          quantity,
          alternatives,
          source: requirementSource,
        },
      },
    },
  },
};

export const confirmPackageResponseSchema: SchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "object_id", "package_version"],
  properties: {
    schema_version: { type: "integer", enum: [1] },
    object_id: uuid,
    package_version: {
      type: "integer",
      minimum: 1,
      description: "Номер новой подтверждённой версии перечня",
    },
  },
};

const stageStatus: SchemaObject = {
  type: "object",
  nullable: true,
  description: "Статус стадии по ТЗ; null — основание для оценки отсутствует",
  additionalProperties: false,
  required: ["status", "applicable", "fulfilled", "missing", "unverifiable"],
  properties: {
    status: {
      type: "string",
      enum: ["UPLOADED", "PARTIAL", "MISSING"],
    },
    applicable: { type: "integer", minimum: 0 },
    fulfilled: { type: "integer", minimum: 0 },
    missing: { type: "integer", minimum: 0 },
    unverifiable: { type: "integer", minimum: 0 },
  },
};

const requirementOutcome: SchemaObject = {
  type: "object",
  additionalProperties: false,
  required: [
    "requirement_id",
    "code",
    "title",
    "stage",
    "scope",
    "outcome",
    "reasons",
    "matched",
    "missing_parts",
  ],
  properties: {
    requirement_id: uuid,
    code: { type: "string" },
    title: { type: "string" },
    stage,
    scope,
    outcome: {
      type: "string",
      enum: ["fulfilled", "missing", "not_applicable", "unverifiable"],
    },
    reasons: {
      type: "array",
      items: { type: "string" },
      description: "Все причины сохраняются раздельно, не свёртываются",
    },
    matched: {
      type: "array",
      description:
        "Выбранные источники; представления одного акта — один элемент",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["file_id"],
        properties: {
          file_id: uuid,
          document_id: uuid,
          revision_id: uuid,
          revision_ids: { type: "array", items: uuid },
        },
      },
    },
    missing_parts: {
      type: "array",
      items: { type: "string" },
      description: "Недостающие части требования (область, листы, экземпляр)",
    },
  },
};

const evaluation: SchemaObject = {
  type: "object",
  nullable: true,
  additionalProperties: false,
  required: ["stages", "scenario", "requirements", "counts"],
  properties: {
    stages: {
      type: "object",
      additionalProperties: false,
      required: ["PD", "RD", "ID"],
      properties: { PD: stageStatus, RD: stageStatus, ID: stageStatus },
    },
    scenario: {
      type: "string",
      enum: [
        "FULL",
        "PD_RD_ONLY",
        "PD_ID_ONLY",
        "RD_ID_ONLY",
        "SINGLE_ONLY",
        "PARTIALLY_LOADED",
      ],
    },
    requirements: { type: "array", items: requirementOutcome },
    counts: {
      type: "object",
      additionalProperties: false,
      required: [
        "applicable",
        "fulfilled",
        "missing",
        "unverifiable",
        "not_applicable",
      ],
      properties: {
        applicable: { type: "integer", minimum: 0 },
        fulfilled: { type: "integer", minimum: 0 },
        missing: { type: "integer", minimum: 0 },
        unverifiable: { type: "integer", minimum: 0 },
        not_applicable: { type: "integer", minimum: 0 },
      },
    },
  },
};

export const completenessResultSchema: SchemaObject = {
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "object_id",
    "process_id",
    "run_id",
    "package_version",
    "framework_version",
    "evaluated_at",
    "evaluation",
    "evaluation_absent_reason",
  ],
  properties: {
    schema_version: { type: "integer", enum: [1] },
    object_id: uuid,
    process_id: { ...uuid, nullable: true },
    run_id: { ...uuid, nullable: true },
    resolved_input_hash: {
      type: "string",
      nullable: true,
      pattern: "^[0-9a-f]{64}$",
    },
    package_version: { type: "integer", minimum: 1, nullable: true },
    framework_version: { type: "integer", minimum: 1, nullable: true },
    evaluated_at: { type: "string", format: "date-time", nullable: true },
    evaluation,
    evaluation_absent_reason: {
      type: "string",
      nullable: true,
      description:
        "Причина отсутствия оценки (например package_not_confirmed); " +
        "null при наличии evaluation",
    },
  },
};
