import { apiClient } from "@/api/client";
import { ApiError } from "@/api/errors";
import {
  decisionResponseSchema,
  finalizeResponseSchema,
  findingDetailResponseSchema,
  findingsResponseSchema,
  generateResponseSchema,
  protocolResponseSchema,
  type DecisionRequest,
} from "@/api/types/verification";

export async function getProtocol(
  objectId: string,
  signal?: AbortSignal,
  protocolId?: string,
) {
  const response = await apiClient.get<unknown>(
    `/v1/objects/${objectId}/protocol`,
    { signal, ...(protocolId ? { params: { protocol_id: protocolId } } : {}) },
  );
  const result = protocolResponseSchema.parse(response.data);
  if (
    result.object_id !== objectId ||
    (protocolId && result.protocol?.id !== protocolId)
  )
    throw new ApiError("Версия протокола изменилась. Обновите результаты.", {
      status: 409,
    });
  return result;
}

export async function listFindings(
  objectId: string,
  filter: { status?: string; q?: string; protocol_id?: string } = {},
  signal?: AbortSignal,
) {
  const response = await apiClient.get<unknown>(
    `/v1/objects/${objectId}/findings`,
    { params: filter, signal },
  );
  const result = findingsResponseSchema.parse(response.data);
  if (
    result.object_id !== objectId ||
    (filter.protocol_id && result.protocol_id !== filter.protocol_id)
  )
    throw new ApiError("Находки относятся к другой версии протокола.", {
      status: 409,
    });
  return result;
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
  const result = findingDetailResponseSchema.parse(response.data);
  if (result.object_id !== objectId || result.finding.id !== findingId)
    throw new ApiError("Источник находки изменился. Обновите результаты.", {
      status: 409,
    });
  return result;
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
