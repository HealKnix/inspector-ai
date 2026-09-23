import { z } from "zod";

const stageSchema = z.enum(["PD", "RD", "ID"]);
const coordinate = z.number().min(0).max(1);
export const classificationEvidenceSchema = z.object({
  page_number: z.number().int().positive(),
  block_id: z.string().min(1),
  quote: z.string().min(1),
  bbox: z
    .tuple([coordinate, coordinate, coordinate, coordinate])
    .refine(
      ([x0, y0, x1, y1]) => x1 > x0 && y1 > y0,
      "Invalid evidence rectangle",
    ),
  structural_path: z.string().nullable(),
});

const candidateSchema = z.object({
  stage: stageSchema,
  document_kind: z.string().nullable(),
  method: z.enum(["rules", "llm"]),
  evidence: z.array(classificationEvidenceSchema),
  reasons: z.array(z.string()),
});

export const classificationResultSchema = z.object({
  schema_version: z.literal(1),
  stage: stageSchema.nullable(),
  document_kind: z.string().nullable(),
  kind_code: z.string().nullable().optional(),
  method: z.enum(["rules", "llm", "none", "manual"]),
  needs_review: z.boolean(),
  reasons: z.array(z.string()),
  evidence: z.array(classificationEvidenceSchema),
  candidates: z.array(candidateSchema),
  versions: z.object({
    classifier: z.string(),
    rules: z.string(),
    context: z.string(),
    prompt: z.string(),
    model: z.string().nullable(),
  }),
});

export const classificationFileSchema = z.object({
  file_id: z.uuid(),
  process_id: z.uuid(),
  run_id: z.uuid(),
  artifact_id: z.uuid(),
  original_name: z.string(),
  task_id: z.uuid().nullable(),
  state: z.enum(["queued", "processing", "succeeded", "failed"]),
  can_retry: z.boolean(),
  error_code: z.string().nullable(),
  result: classificationResultSchema.nullable(),
});

export const classificationStatusSchema = z.object({
  schema_version: z.literal(1),
  active: z.boolean(),
  poll_after_ms: z.number().int().positive(),
  items: z.array(classificationFileSchema),
});

export const classificationRetrySchema = z.object({
  request_id: z.uuid(),
  task_id: z.uuid(),
});

const kindOptionSchema = z.object({
  code: z.string().min(1),
  title: z.string().min(1),
});

export const kindOptionsSchema = z.object({
  schema_version: z.literal(1),
  options: z.object({
    PD: z.array(kindOptionSchema),
    RD: z.array(kindOptionSchema),
    ID: z.array(kindOptionSchema),
  }),
});

export const classificationResolveSchema = z.object({
  task_id: z.uuid(),
  unchanged: z.boolean(),
});

export type ClassificationEvidence = z.infer<
  typeof classificationEvidenceSchema
>;
export type ClassificationResult = z.infer<typeof classificationResultSchema>;
export type ClassificationFile = z.infer<typeof classificationFileSchema>;
export type ClassificationStatus = z.infer<typeof classificationStatusSchema>;
export type KindOption = z.infer<typeof kindOptionSchema>;
export type KindOptions = z.infer<typeof kindOptionsSchema>["options"];
