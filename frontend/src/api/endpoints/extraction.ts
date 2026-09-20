import { apiClient } from "@/api/client";
import {
  evidenceGroupsSchema,
  extractionStatusSchema,
} from "@/api/types/extraction";

export async function getExtractions(objectId: string, signal?: AbortSignal) {
  const response = await apiClient.get<unknown>(
    `/v1/objects/${objectId}/extractions`,
    { signal },
  );
  return extractionStatusSchema.parse(response.data);
}

export async function getEvidenceGroups(
  objectId: string,
  signal?: AbortSignal,
) {
  const response = await apiClient.get<unknown>(
    `/v1/objects/${objectId}/evidence-groups`,
    { signal },
  );
  return evidenceGroupsSchema.parse(response.data);
}
