import { apiClient } from "@/api/client";
import {
  decisionResponseSchema,
  finalizeResponseSchema,
  findingDetailResponseSchema,
  findingsResponseSchema,
  generateResponseSchema,
  protocolResponseSchema,
  type DecisionRequest,
} from "@/api/types/verification";

export async function getProtocol(objectId: string, signal?: AbortSignal) {
  const response = await apiClient.get<unknown>(
    `/v1/objects/${objectId}/protocol`,
    { signal },
  );
  return protocolResponseSchema.parse(response.data);
}

export async function listFindings(
  objectId: string,
  filter: { status?: string; q?: string } = {},
  signal?: AbortSignal,
) {
  const response = await apiClient.get<unknown>(
    `/v1/objects/${objectId}/findings`,
    { params: filter, signal },
  );
  return findingsResponseSchema.parse(response.data);
}

export async function getFinding(
  objectId: string,
  findingId: string,
  signal?: AbortSignal,
) {
  const response = await apiClient.get<unknown>(
    `/v1/objects/${objectId}/findings/${findingId}`,
    { signal },
  );
  return findingDetailResponseSchema.parse(response.data);
}

export async function postDecision(
  objectId: string,
  findingId: string,
  body: DecisionRequest,
) {
  const response = await apiClient.post<unknown>(
    `/v1/objects/${objectId}/findings/${findingId}/decision`,
    body,
  );
  return decisionResponseSchema.parse(response.data);
}

export async function generateProtocol(objectId: string) {
  const response = await apiClient.post<unknown>(
    `/v1/objects/${objectId}/protocol/generate`,
  );
  return generateResponseSchema.parse(response.data);
}

export async function finalizeProtocol(objectId: string) {
  const response = await apiClient.post<unknown>(
    `/v1/objects/${objectId}/protocol/finalize`,
  );
  return finalizeResponseSchema.parse(response.data);
}
