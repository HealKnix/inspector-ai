import { Ajv } from "ajv";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  clarificationRequestSchema,
  clarificationResponseSchema,
  identificationRegistrySchema,
} from "./identification-openapi.js";
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
describe("identification OpenAPI contracts", () => {
  it("requires Run, card version and basis while rejecting invented metadata", () => {
    const validate = ajv.compile(clarificationRequestSchema);
    const input = {
      request_id: randomUUID(),
      expected_run_id: randomUUID(),
      basis: "Проверен титул",
      documents: [
        {
          document_id: randomUUID(),
          expected_version: 1,
          revisions: [{ revision_id: randomUUID(), fields: { number: "52" } }],
        },
      ],
    };
    expect(validate(input), ajv.errorsText(validate.errors)).toBe(true);
    for (const key of ["request_id", "expected_run_id", "basis"]) {
      const broken: Record<string, unknown> = structuredClone(input);
      delete broken[key];
      expect(validate(broken)).toBe(false);
    }
    expect(
      validate({
        ...input,
        documents: [{ ...input.documents[0], expected_version: 0 }],
      }),
    ).toBe(false);
    expect(
      validate({
        ...input,
        documents: [
          {
            ...input.documents[0],
            revisions: [
              { ...input.documents[0]!.revisions[0], fields: { signed: true } },
            ],
          },
        ],
      }),
    ).toBe(false);
  });
  it("describes queued identification and a recalculation awaiting a new pipeline", () => {
    const validate = ajv.compile(identificationRegistrySchema);
    const id = randomUUID();
    const sample = {
      schema_version: 1,
      object_id: id,
      process_id: id,
      run_id: id,
      current_run_id: id,
      process_status: "PENDING",
      current: true,
      active: true,
      allowed_actions: { apply: false },
      identification_state: "queued",
      error_code: null,
      resolved_input_hash: null,
      input_manifest_hash: "a".repeat(64),
      documents: [],
      contexts: [],
      blockers: ["identification_pending"],
    };
    expect(validate(sample), ajv.errorsText(validate.errors)).toBe(true);
    const response = ajv.compile(clarificationResponseSchema);
    expect(
      response({
        schema_version: 1,
        request_id: id,
        process_id: id,
        run_id: id,
        previous_run_id: id,
        resolved_input_hash: null,
        replayed: false,
      }),
      ajv.errorsText(response.errors),
    ).toBe(true);
  });
});
