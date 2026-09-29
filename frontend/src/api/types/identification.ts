import { z } from "zod";

export const identificationFieldSchema = z.enum([
  "stage",
  "kind_code",
  "title",
  "number",
  "date",
  "code",
  "scope",
  "works_from",
  "works_to",
  "revision_label",
  "reference_code",
  "external_id",
  "observed_edition",
  "observed_status",
  "observed_replaced_sheet",
]);
export type IdentificationField = z.infer<typeof identificationFieldSchema>;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const identificationEvidenceSchema = z.object({
  file_id: z.uuid(),
  artifact_id: z.uuid(),
  artifact_sha256: hash,
  source_sha256: hash,
  page_number: z.number().int().positive(),
  block_id: z.string(),
  quote: z.string(),
  bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  structural_path: z.string().nullable(),
  parse_context: z
    .object({
      source: z.string(),
      native_valid: z.boolean().nullable(),
      include_in_main: z.boolean().nullable(),
      region_id: z.string().nullable(),
      region_kind: z.string().nullable(),
      region_method: z.string().nullable(),
      text_status: z.string().nullable(),
      reasons: z.array(z.string()),
    })
    .optional(),
});
export type IdentificationEvidence = z.infer<
  typeof identificationEvidenceSchema
>;
const candidateSchema = z.object({
  candidate_id: z.string(),
  field: identificationFieldSchema,
  raw: z.string(),
  normalized: z.string().nullable(),
  role: z.enum(["own", "reference", "observed"]),
  method: z.enum(["rules", "classification", "llm"]),
  engine_version: z.string(),
  evidence: z.array(identificationEvidenceSchema),
});
export const revisionApprovalSchema = z.object({
  confirmed: z.boolean(),
  effective_from: z.string().nullable(),
  effective_to: z.string().nullable(),
  replaces_revision_id: z.uuid().nullable(),
  basis: z.string().nullable(),
});
const sheetLabelSchema = z
  .string()
  .min(1)
  .max(80)
  .refine(
    (value) =>
      value === value.trim().normalize("NFC") &&
      ![...value].some((character) => character.charCodeAt(0) < 32),
    "Укажите обозначение листа без переносов и крайних пробелов",
  );
const physicalPageSchema = z.number().int().min(1).max(500);
export const sheetMapSchema = z
  .object({
    file_id: z.uuid(),
    source_sha256: hash,
    sheets: z
      .array(
        z.object({ label: sheetLabelSchema, page_number: physicalPageSchema }),
      )
      .min(1)
      .max(500),
    excluded_pages: z.array(physicalPageSchema).max(500),
    basis: z.string().trim().min(1).max(4000),
  })
  .refine((value) => {
    const labels = value.sheets.map((sheet) => sheet.label);
    const pages = [
      ...value.sheets.map((sheet) => sheet.page_number),
      ...value.excluded_pages,
    ];
    return (
      new Set(labels).size === labels.length &&
      new Set(pages).size === pages.length
    );
  }, "Листы и физические страницы не должны повторяться");
export type SheetMap = z.infer<typeof sheetMapSchema>;
export const sheetReplacementSchema = z
  .object({
    predecessor_revision_id: z.uuid(),
    replaced_labels: z.array(sheetLabelSchema).min(1).max(500),
    basis: z.string().trim().min(1).max(4000),
  })
  .refine(
    (value) =>
      new Set(value.replaced_labels).size === value.replaced_labels.length,
    "Обозначения заменяемых листов не должны повторяться",
  );
export type SheetReplacement = z.infer<typeof sheetReplacementSchema>;
const resolvedSheetSetSchema = z.object({
  selection_hash: hash,
  sheets: z.array(
    z.object({
      label: sheetLabelSchema,
      page_number: physicalPageSchema,
      document_id: z.uuid(),
      revision_id: z.uuid(),
      file_id: z.uuid(),
      artifact_id: z.uuid(),
      artifact_sha256: hash,
      source_sha256: hash,
    }),
  ),
  chain: z.array(z.object({ revision_id: z.uuid(), decision_hash: hash })),
});
export const identificationRevisionSchema = z.object({
  revision_id: z.uuid(),
  fields: z.partialRecord(identificationFieldSchema, z.string()),
  candidates: z.array(candidateSchema),
  representations: z.array(
    z.object({
      file_id: z.uuid(),
      artifact_id: z.uuid(),
      artifact_sha256: hash,
      source_sha256: hash,
      format: z.string(),
      page_count: z.number().int().nonnegative(),
    }),
  ),
  approval: revisionApprovalSchema,
  blockers: z.array(z.string()),
  reference_revision_id: z.uuid().nullable().optional(),
  sheet_map: sheetMapSchema.nullable().optional(),
  sheet_replacement: sheetReplacementSchema.nullable().optional(),
});
export type IdentificationRevision = z.infer<
  typeof identificationRevisionSchema
>;
export const identificationDocumentSchema = z.object({
  document_id: z.uuid(),
  card_version: z.number().int().positive(),
  revisions: z.array(identificationRevisionSchema),
});
export type IdentificationDocument = z.infer<
  typeof identificationDocumentSchema
>;
const referenceSchema = z.object({
  document_id: z.uuid(),
  revision_id: z.uuid(),
});
export const identificationRegistrySchema = z.object({
  schema_version: z.literal(1),
  object_id: z.uuid(),
  process_id: z.uuid(),
  process_status: z.string(),
  current_run_id: z.uuid(),
  run_id: z.uuid(),
  current: z.boolean(),
  active: z.boolean(),
  allowed_actions: z.object({ apply: z.boolean() }),
  resolved_input_hash: hash.nullable(),
  snapshot_versions: z
    .array(
      z.object({
        version: z.number().int().positive(),
        resolved_input_hash: hash,
        created_at: z.string(),
      }),
    )
    .optional(),
  documents: z.array(identificationDocumentSchema),
  contexts: z.array(
    z.object({
      context_id: z.string(),
      scope: z.string(),
      works_period: z.object({
        from: z.string().nullable(),
        to: z.string().nullable(),
      }),
      reference: referenceSchema.nullable(),
      actual: referenceSchema,
      status: z.enum(["READY", "CLARIFICATION_REQUIRED"]),
      blockers: z.array(z.string()),
      sheet_selection: z
        .object({
          reference: resolvedSheetSetSchema.nullable(),
          actual: resolvedSheetSetSchema.nullable(),
        })
        .optional(),
    }),
  ),
  blockers: z.array(z.string()),
  identification_state: z.string().nullable().optional(),
  error_code: z.string().nullable().optional(),
  document_aliases: z
    .array(
      z.object({
        document_id: z.uuid(),
        revision_id: z.uuid(),
        card_version: z.number().int().positive(),
        canonical_document_id: z.uuid(),
        canonical_revision_id: z.uuid(),
      }),
    )
    .optional(),
});
export type IdentificationRegistry = z.infer<
  typeof identificationRegistrySchema
>;
export const identificationDetailSchema = identificationRegistrySchema.extend({
  document: identificationDocumentSchema,
  history: z.array(
    z.object({
      id: z.uuid(),
      document_id: z.uuid(),
      revision_id: z.uuid(),
      actor_id: z.string(),
      request_id: z.uuid(),
      card_version: z.number().int().positive(),
      basis: z.string(),
      patch: z.unknown(),
      created_at: z.string(),
      run_id: z.uuid(),
    }),
  ),
});
export const revisionClarificationSchema = z.object({
  revision_id: z.uuid(),
  fields: z
    .partialRecord(identificationFieldSchema, z.string().nullable())
    .optional(),
  approval: revisionApprovalSchema.optional(),
  reference_revision_id: z.uuid().nullable().optional(),
  sheet_map: sheetMapSchema.nullable().optional(),
  sheet_replacement: sheetReplacementSchema.nullable().optional(),
});
export type RevisionClarification = z.infer<typeof revisionClarificationSchema>;
export const documentClarificationSchema = z.object({
  document_id: z.uuid(),
  expected_version: z.number().int().positive(),
  revisions: z.array(revisionClarificationSchema).min(1),
});
export type DocumentClarification = z.infer<typeof documentClarificationSchema>;
export const clarificationBatchSchema = z.object({
  request_id: z.uuid(),
  expected_run_id: z.uuid(),
  documents: z.array(documentClarificationSchema).min(1),
  basis: z.string().trim().min(1, "Укажите основание изменений").max(4000),
});
export type ClarificationBatch = z.infer<typeof clarificationBatchSchema>;
export const clarificationResultSchema = z.object({
  schema_version: z.literal(1),
  request_id: z.uuid(),
  process_id: z.uuid(),
  run_id: z.uuid(),
  previous_run_id: z.uuid(),
  resolved_input_hash: hash.nullable(),
  replayed: z.boolean(),
});
