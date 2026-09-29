import type { OpenAPIObject } from "@nestjs/swagger";
import { IDENTIFICATION_FIELDS } from "./identification-contract.js";
type SchemaObject = NonNullable<
  NonNullable<OpenAPIObject["components"]>["schemas"]
>[string];

const evidence: SchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["page_number", "block_id", "quote", "bbox", "structural_path"],
  properties: {
    page_number: { type: "integer", minimum: 1 },
    block_id: { type: "string" },
    quote: { type: "string" },
    bbox: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: { type: "number", minimum: 0, maximum: 1 },
    },
    structural_path: { type: "string", nullable: true },
  },
};
const reasons: SchemaObject = { type: "array", items: { type: "string" } };
const result: SchemaObject = {
  type: "object",
  nullable: true,
  additionalProperties: false,
  required: [
    "schema_version",
    "stage",
    "document_kind",
    "method",
    "needs_review",
    "reasons",
    "evidence",
    "candidates",
    "versions",
  ],
  properties: {
    schema_version: { type: "integer", enum: [1] },
    stage: { type: "string", enum: ["PD", "RD", "ID", null], nullable: true },
    document_kind: { type: "string", nullable: true },
    method: { type: "string", enum: ["rules", "llm", "none"] },
    needs_review: { type: "boolean" },
    reasons,
    evidence: { type: "array", items: evidence },
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["stage", "document_kind", "method", "evidence", "reasons"],
        properties: {
          stage: { type: "string", enum: ["PD", "RD", "ID"] },
          document_kind: { type: "string", nullable: true },
          method: { type: "string", enum: ["rules", "llm"] },
          evidence: { type: "array", items: evidence },
          reasons,
        },
      },
    },
    versions: {
      type: "object",
      additionalProperties: false,
      required: ["classifier", "rules", "context", "prompt", "model"],
      properties: {
        classifier: { type: "string" },
        rules: { type: "string" },
        context: { type: "string" },
        prompt: { type: "string" },
        model: { type: "string", nullable: true },
      },
    },
  },
};
export const classificationListSchema: SchemaObject = {
  type: "object",
  additionalProperties: false,
  required: [
    "schema_version",
    "active",
    "review_active",
    "poll_after_ms",
    "items",
  ],
  properties: {
    schema_version: { type: "integer", enum: [1] },
    active: { type: "boolean" },
    review_active: {
      type: "boolean",
      description:
        "Обновляется карточка идентификации; review появится после публикации актуального снимка.",
    },
    poll_after_ms: { type: "integer", enum: [2000] },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "file_id",
          "process_id",
          "run_id",
          "artifact_id",
          "original_name",
          "task_id",
          "state",
          "can_retry",
          "error_code",
          "result",
          "review",
        ],
        properties: {
          file_id: { type: "string", format: "uuid" },
          process_id: { type: "string", format: "uuid" },
          run_id: { type: "string", format: "uuid" },
          artifact_id: { type: "string", format: "uuid" },
          original_name: { type: "string" },
          task_id: { type: "string", format: "uuid", nullable: true },
          state: {
            type: "string",
            enum: ["queued", "processing", "succeeded", "failed"],
          },
          can_retry: { type: "boolean" },
          error_code: { type: "string", nullable: true },
          result,
          review: {
            type: "object",
            nullable: true,
            additionalProperties: false,
            description:
              "Текущая карточка и подтверждённые поля. Машинный result не изменяется; ограничения источника сохраняются отдельно.",
            required: [
              "document_id",
              "revision_id",
              "card_version",
              "resolved_input_hash",
              "fields",
              "confirmed_fields",
              "needs_review",
              "reasons",
              "source_issues",
            ],
            properties: {
              document_id: { type: "string", format: "uuid" },
              revision_id: { type: "string", format: "uuid" },
              card_version: { type: "integer", minimum: 1 },
              resolved_input_hash: {
                type: "string",
                pattern: "^[a-f0-9]{64}$",
              },
              fields: {
                type: "object",
                additionalProperties: false,
                properties: Object.fromEntries(
                  IDENTIFICATION_FIELDS.map((field) => [
                    field,
                    { type: "string" },
                  ]),
                ),
              },
              confirmed_fields: {
                type: "array",
                items: { type: "string", enum: [...IDENTIFICATION_FIELDS] },
              },
              needs_review: { type: "boolean" },
              reasons,
              source_issues: reasons,
            },
          },
        },
      },
    },
  },
};
