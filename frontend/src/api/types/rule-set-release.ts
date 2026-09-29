import { z } from "zod";
export const releaseSchema = z.object({
  id: z.uuid(),
  manifestHash: z.string(),
  createdAt: z.string(),
  createdBy: z.string(),
  manifest: z
    .object({
      schema_version: z.literal(1),
      mode: z.enum(["partial", "full", "legacy_capture"]),
      catalog: z
        .object({ catalog_sha256: z.string(), row_count: z.number() })
        .passthrough()
        .nullable(),
      engines: z.record(z.string(), z.string()),
      entries: z.array(
        z
          .object({
            parameter_code: z.string(),
            rule_version_id: z.uuid(),
            version: z.number().int(),
          })
          .passthrough(),
      ),
      omitted_parameter_codes: z.array(z.string()),
    })
    .passthrough(),
});
export const releaseListSchema = z.object({
  schema_version: z.literal(1),
  active_release_id: z.uuid().nullable(),
  releases: z.array(releaseSchema),
});
export type SelectedRule = {
  id: string;
  parameterCode: string;
  version: number;
};
