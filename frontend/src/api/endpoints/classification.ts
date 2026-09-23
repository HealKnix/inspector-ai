import { apiClient } from "@/api/client";
import { ApiError } from "@/api/errors";
import {
  classificationResolveSchema,
  classificationRetrySchema,
  classificationStatusSchema,
  kindOptionsSchema,
} from "@/api/types/classification";

export async function getClassificationStatus(
  objectId: string,
  signal?: AbortSignal,
) {
  const response = await apiClient.get<unknown>(
    `/v1/objects/${objectId}/classification`,
    { signal },
  );
  return classificationStatusSchema.parse(response.data);
}

export async function retryClassification(input: {
  objectId: string;
  fileId: string;
  requestId: string;
}) {
  const response = await apiClient.post<unknown>(
    `/v1/objects/${input.objectId}/files/${input.fileId}/classification/retry`,
    { request_id: input.requestId },
  );
  const result = classificationRetrySchema.parse(response.data);
  if (result.request_id !== input.requestId) {
    throw new ApiError("Не удалось подтвердить запрос классификации.", {
      status: 409,
    });
  }
  return result;
}

export async function getKindOptions(objectId: string, signal?: AbortSignal) {
  const response = await apiClient.get<unknown>(
    `/v1/objects/${objectId}/classification/kind-options`,
    { signal },
  );
  return kindOptionsSchema.parse(response.data);
}

export async function resolveClassification(input: {
  objectId: string;
  fileId: string;
  kindCode: string;
  stage?: "PD" | "RD" | "ID";
}) {
  const response = await apiClient.post<unknown>(
    `/v1/objects/${input.objectId}/files/${input.fileId}/classification/resolve`,
    { kind_code: input.kindCode, stage: input.stage },
  );
  return classificationResolveSchema.parse(response.data);
}
