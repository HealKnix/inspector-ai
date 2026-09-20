import type { OpenAPIObject } from "@nestjs/swagger";
import type { FileFormat } from "../../infrastructure/storage/file-safety.service.js";
type SchemaObject = NonNullable<
  NonNullable<OpenAPIObject["components"]>["schemas"]
>[string];

export interface FileOutcome {
  client_file_id: string;
  original_name: string;
  accepted: boolean;
  file_id?: string;
  existing_file_id?: string;
  sha256?: string;
  size?: number;
  format?: FileFormat;
  error?: string;
  message?: string;
}
export interface UploadResponse {
  schema_version: 1;
  object_id: string;
  client_upload_id: string;
  process_id: string | null;
  run_id: string | null;
  files: FileOutcome[];
}

export const uploadRequestSchema: SchemaObject = {
  type: "object",
  additionalProperties: false,
  required: ["object_id", "client_upload_id", "files"],
  properties: {
    object_id: { type: "string", format: "uuid" },
    process_id: { type: "string", format: "uuid" },
    client_upload_id: {
      type: "string",
      format: "uuid",
      description:
        "Ключ: пользователь + объект + client_upload_id; повтор с иным содержимым — 409",
    },
    files: {
      type: "array",
      minItems: 1,
      maxItems: 1000,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["client_file_id", "original_name", "content_base64"],
        properties: {
          client_file_id: { type: "string", format: "uuid" },
          original_name: { type: "string", minLength: 1, maxLength: 512 },
          content_base64: {
            type: "string",
            format: "byte",
            description:
              "Не более 50 000 000 декодированных байт на файл; 200 000 000 на весь пакет",
          },
        },
      },
    },
  },
};

export const uploadResponseSchema: SchemaObject = {
  type: "object",
  required: [
    "schema_version",
    "object_id",
    "client_upload_id",
    "process_id",
    "run_id",
    "files",
  ],
  properties: {
    schema_version: { type: "integer", enum: [1] },
    object_id: { type: "string", format: "uuid" },
    client_upload_id: { type: "string", format: "uuid" },
    process_id: { type: "string", format: "uuid", nullable: true },
    run_id: { type: "string", format: "uuid", nullable: true },
    files: {
      type: "array",
      items: {
        type: "object",
        required: ["client_file_id", "original_name", "accepted"],
        properties: {
          client_file_id: { type: "string", format: "uuid" },
          original_name: { type: "string" },
          accepted: { type: "boolean" },
          file_id: { type: "string", format: "uuid" },
          existing_file_id: {
            type: "string",
            format: "uuid",
            description:
              "Уже сохранённый файл этого объекта при error=duplicate_file",
          },
          sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
          size: { type: "integer" },
          format: { type: "string", enum: ["PDF", "DOCX", "XML"] },
          error: {
            type: "string",
            enum: [
              "duplicate_file",
              "file_too_large",
              "infected",
              "scanner_limit",
              "scanner_unavailable",
              "validator_unavailable",
              "unsafe_format",
            ],
          },
          message: { type: "string" },
        },
      },
    },
  },
};

const exampleBase = {
  schema_version: 1,
  object_id: "11111111-1111-4111-8111-111111111111",
  client_upload_id: "22222222-2222-4222-8222-222222222222",
};
const rejectedFile = {
  client_file_id: "33333333-3333-4333-8333-333333333333",
  original_name: "damaged.pdf",
  accepted: false,
  error: "unsafe_format",
  message: "Повреждённый или неподдерживаемый документ",
};
export const rejectedExample = {
  ...exampleBase,
  process_id: null,
  run_id: null,
  files: [rejectedFile],
};
export const mixedExample = {
  ...exampleBase,
  process_id: "44444444-4444-4444-8444-444444444444",
  run_id: "55555555-5555-4555-8555-555555555555",
  files: [
    {
      client_file_id: "66666666-6666-4666-8666-666666666666",
      original_name: "example.xml",
      accepted: true,
      file_id: "77777777-7777-4777-8777-777777777777",
      sha256: "d".repeat(64),
      size: 4,
      format: "XML",
    },
    rejectedFile,
  ],
};

export const apiErrorSchema: SchemaObject = {
  type: "object",
  required: ["statusCode", "message"],
  properties: {
    statusCode: { type: "integer" },
    error: { type: "string" },
    message: {
      oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
    },
  },
};
