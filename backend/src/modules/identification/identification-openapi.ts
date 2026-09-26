import type { OpenAPIObject } from "@nestjs/swagger";
import { IDENTIFICATION_FIELDS } from "./identification-contract.js";
type Schema = NonNullable<
  NonNullable<OpenAPIObject["components"]>["schemas"]
>[string];
const uuid = { type: "string", format: "uuid" } satisfies Schema;
const text = { type: "string" } satisfies Schema;
const hash = { type: "string", pattern: "^[a-f0-9]{64}$" } satisfies Schema;
const date = {
  type: "string",
  format: "date",
  nullable: true,
} satisfies Schema;
const strings = { type: "array", items: text } satisfies Schema;
const fields = (nullable = false): Schema => ({
  type: "object",
  additionalProperties: false,
  properties: Object.fromEntries(
    IDENTIFICATION_FIELDS.map((field) => [
      field,
      { type: "string", nullable, minLength: 1, maxLength: 2000 },
    ]),
  ),
});
const object = (
  properties: Record<string, Schema>,
  required = Object.keys(properties),
): Schema => ({
  type: "object",
  additionalProperties: false,
  required,
  properties,
});
export const approvalSchema: Schema = object({
  confirmed: { type: "boolean" },
  effective_from: date,
  effective_to: date,
  replaces_revision_id: { ...uuid, nullable: true },
  basis: { type: "string", nullable: true, minLength: 1, maxLength: 4000 },
});
export const revisionClarificationSchema: Schema = object(
  {
    revision_id: uuid,
    fields: fields(true),
    approval: approvalSchema,
    reference_revision_id: { ...uuid, nullable: true },
  },
  ["revision_id"],
);
export const clarificationRequestSchema: Schema = object({
  request_id: uuid,
  expected_run_id: uuid,
  basis: { type: "string", minLength: 1, maxLength: 4000 },
  documents: {
    type: "array",
    minItems: 1,
    maxItems: 200,
    items: object({
      document_id: uuid,
      expected_version: { type: "integer", minimum: 1 },
      revisions: {
        type: "array",
        minItems: 1,
        maxItems: 200,
        items: revisionClarificationSchema,
      },
    }),
  },
});
export const clarificationResponseSchema: Schema = object({
  schema_version: { type: "integer", enum: [1] },
  request_id: uuid,
  process_id: uuid,
  run_id: uuid,
  previous_run_id: uuid,
  resolved_input_hash: { ...hash, nullable: true },
  replayed: { type: "boolean" },
});
const evidence: Schema = object({
  file_id: uuid,
  artifact_id: uuid,
  artifact_sha256: hash,
  source_sha256: hash,
  page_number: { type: "integer", minimum: 1 },
  block_id: text,
  quote: text,
  bbox: {
    type: "array",
    items: { type: "number", minimum: 0, maximum: 1 },
    minItems: 4,
    maxItems: 4,
  },
  structural_path: { ...text, nullable: true },
});
const candidate: Schema = object({
  candidate_id: text,
  field: { type: "string", enum: [...IDENTIFICATION_FIELDS] },
  raw: text,
  normalized: { ...text, nullable: true },
  role: { type: "string", enum: ["own", "reference", "observed"] },
  method: { type: "string", enum: ["rules", "classification", "llm"] },
  engine_version: text,
  evidence: { type: "array", items: evidence },
});
const representation: Schema = object({
  file_id: uuid,
  artifact_id: uuid,
  artifact_sha256: hash,
  source_sha256: hash,
  format: text,
  page_count: { type: "integer", minimum: 1 },
});
const revision: Schema = object(
  {
    revision_id: uuid,
    fields: fields(),
    candidates: { type: "array", items: candidate },
    representations: { type: "array", items: representation },
    approval: approvalSchema,
    blockers: strings,
    reference_revision_id: { ...uuid, nullable: true },
  },
  [
    "revision_id",
    "fields",
    "candidates",
    "representations",
    "approval",
    "blockers",
  ],
);
export const identificationDocumentSchema: Schema = object({
  document_id: uuid,
  card_version: { type: "integer", minimum: 1 },
  revisions: { type: "array", items: revision },
});
const ref: Schema = object({ document_id: uuid, revision_id: uuid });
const context: Schema = object({
  context_id: text,
  scope: text,
  works_period: object({ from: date, to: date }),
  reference: { ...ref, nullable: true },
  actual: ref,
  status: { type: "string", enum: ["READY", "CLARIFICATION_REQUIRED"] },
  blockers: strings,
});
const alias: Schema = object({
  document_id: uuid,
  revision_id: uuid,
  card_version: { type: "integer", minimum: 1 },
  canonical_document_id: uuid,
  canonical_revision_id: uuid,
});
const history: Schema = {
  type: "object",
  required: ["basis", "card_version"],
  properties: {
    id: uuid,
    document_id: uuid,
    revision_id: uuid,
    run_id: uuid,
    actor_id: text,
    request_id: uuid,
    card_version: { type: "integer", minimum: 1 },
    basis: text,
    patch: revisionClarificationSchema,
    created_at: { type: "string", format: "date-time" },
  },
};
export const identificationRegistrySchema: Schema = {
  type: "object",
  required: [
    "schema_version",
    "object_id",
    "process_id",
    "run_id",
    "current_run_id",
    "process_status",
    "current",
    "active",
    "allowed_actions",
    "identification_state",
    "error_code",
    "resolved_input_hash",
    "input_manifest_hash",
    "documents",
    "contexts",
    "blockers",
  ],
  properties: {
    schema_version: { type: "integer", enum: [1] },
    object_id: uuid,
    process_id: uuid,
    run_id: uuid,
    current_run_id: uuid,
    process_status: {
      type: "string",
      enum: [
        "PENDING",
        "PARSING",
        "READY",
        "VERIFYING",
        "COMPLETED",
        "FINALIZED",
      ],
    },
    current: { type: "boolean" },
    active: { type: "boolean" },
    allowed_actions: object({ apply: { type: "boolean" } }),
    identification_state: {
      type: "string",
      enum: ["queued", "processing", "succeeded", "failed"],
    },
    error_code: { ...text, nullable: true },
    resolved_input_hash: { ...hash, nullable: true },
    input_manifest_hash: hash,
    documents: { type: "array", items: identificationDocumentSchema },
    contexts: { type: "array", items: context },
    blockers: strings,
    document_aliases: { type: "array", items: alias },
    decision_ids: { type: "array", items: uuid },
    policy_versions: { type: "object", additionalProperties: text },
    history: { type: "array", items: history },
    document: identificationDocumentSchema,
    snapshot_versions: {
      type: "array",
      items: object({
        version: { type: "integer", minimum: 1 },
        resolved_input_hash: hash,
        created_at: { type: "string", format: "date-time" },
      }),
    },
  },
};
