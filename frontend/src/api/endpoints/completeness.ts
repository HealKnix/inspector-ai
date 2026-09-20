import { apiClient } from "@/api/client";
import {
  completenessResultSchema,
  expectedPackageResponseSchema,
  packageMutationResponseSchema,
} from "@/api/types/completeness";

export async function getExpectedPackage(
  objectId: string,
  signal?: AbortSignal,
) {
  const response = await apiClient.get<unknown>(
    `/v1/objects/${objectId}/completeness/package`,
    { signal },
  );
  return expectedPackageResponseSchema.parse(response.data);
}

export async function generateExpectedPackage(input: {
  objectId: string;
  attributes: Record<string, unknown>;
  lists?: { list_kind: string; item_key: string; title: string }[];
}) {
  const response = await apiClient.post<unknown>(
    `/v1/objects/${input.objectId}/completeness/package/generate`,
    { attributes: input.attributes, lists: input.lists },
  );
  return packageMutationResponseSchema.parse(response.data);
}

export async function confirmExpectedPackage(input: {
  objectId: string;
  requestId: string;
  expectedVersion: number;
  basis: string;
  attributes: Record<string, unknown>;
  exclude?: { requirement_id: string; reason: string }[];
}) {
  const response = await apiClient.post<unknown>(
    `/v1/objects/${input.objectId}/completeness/package/confirm`,
    {
      request_id: input.requestId,
      expected_version: input.expectedVersion,
      basis: input.basis,
      attributes: input.attributes,
      exclude: input.exclude,
    },
  );
  return packageMutationResponseSchema.parse(response.data);
}

export async function evaluateCompleteness(input: {
  objectId: string;
  runId?: string;
}) {
  const response = await apiClient.post<unknown>(
    `/v1/objects/${input.objectId}/completeness/evaluate`,
    input.runId ? { run_id: input.runId } : {},
  );
  return completenessResultSchema.parse(response.data);
}

export async function getCompletenessResult(
  objectId: string,
  runId?: string,
  signal?: AbortSignal,
) {
  const response = await apiClient.get<unknown>(
    `/v1/objects/${objectId}/completeness/result`,
    { signal, params: runId ? { run_id: runId } : undefined },
  );
  return completenessResultSchema.parse(response.data);
}
