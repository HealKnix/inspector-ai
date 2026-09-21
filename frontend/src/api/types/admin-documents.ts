import { z } from "zod";

export const adminDocumentSchema = z.object({
  id: z.uuid(),
  object_id: z.uuid(),
  object_name: z.string(),
  process_id: z.uuid(),
  run_id: z.uuid(),
  original_name: z.string(),
  size: z.number().int(),
  format: z.enum(["PDF", "DOCX", "XML"]),
  sha256: z.string(),
  created_at: z.iso.datetime(),
  integrity_error: z.boolean(),
  uploaded_by: z.object({
    id: z.uuid(),
    login: z.string(),
    last_name: z.string(),
    first_name: z.string(),
    patronymic: z.string().nullable(),
  }),
  parsing: z
    .object({
      state: z.enum(["queued", "processing", "succeeded", "failed"]),
      pages_total: z.number().int().nonnegative().nullable(),
      error_code: z.string().nullable(),
      artifact_id: z.uuid().nullable(),
    })
    .nullable(),
});

export const adminDocumentListSchema = z.object({
  items: z.array(adminDocumentSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
});

export const adminObjectListSchema = z.object({
  items: z.array(z.object({ id: z.uuid(), name: z.string() })),
});

export type AdminDocument = z.infer<typeof adminDocumentSchema>;
export type AdminObject = z.infer<
  typeof adminObjectListSchema
>["items"][number];

export interface AdminDocumentFilters {
  objectId?: string;
  page?: number;
  q?: string;
  userId?: string;
}
