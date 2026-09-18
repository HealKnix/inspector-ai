import { z } from "zod";

export const objectSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  created_by: z.string(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  allowed_actions: z.array(z.string()),
});
export const objectListSchema = z.object({
  items: z.array(objectSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
  allowed_actions: z.array(z.string()),
});
const commonOutcome = { client_file_id: z.uuid(), original_name: z.string() };
export const uploadResponseSchema = z.object({
  schema_version: z.literal(1),
  object_id: z.uuid(),
  client_upload_id: z.uuid(),
  process_id: z.uuid().nullable(),
  run_id: z.uuid().nullable(),
  files: z.array(
    z.discriminatedUnion("accepted", [
      z.object({
        ...commonOutcome,
        accepted: z.literal(true),
        file_id: z.uuid(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        size: z.number().int(),
        format: z.enum(["PDF", "DOCX", "XML"]),
      }),
      z.object({
        ...commonOutcome,
        accepted: z.literal(false),
        error: z.string(),
        message: z.string(),
        existing_file_id: z.uuid().optional(),
      }),
    ]),
  ),
});
export const fileSchema = z.object({
  id: z.uuid(),
  object_id: z.uuid(),
  process_id: z.uuid(),
  run_id: z.uuid(),
  original_name: z.string(),
  size: z.number().int(),
  format: z.enum(["PDF", "DOCX", "XML"]),
  sha256: z.string(),
  created_at: z.iso.datetime(),
  integrity_error: z.boolean(),
});
export const fileListSchema = z.object({
  items: z.array(fileSchema),
  total: z.number().int(),
  page: z.number().int(),
  limit: z.number().int(),
});
export type ConstructionObject = z.infer<typeof objectSchema>;
export type ObjectFile = z.infer<typeof fileSchema>;
export type UploadResponse = z.infer<typeof uploadResponseSchema>;
export interface SelectedFile {
  id: string;
  file: File;
}
