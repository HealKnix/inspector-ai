import { apiClient } from "@/api/client";
import { ApiError } from "@/api/errors";
import {
  clarificationBatchSchema,
  clarificationResultSchema,
  identificationDetailSchema,
  identificationRegistrySchema,
  type ClarificationBatch,
  type IdentificationEvidence,
} from "@/api/types/identification";
import { parseResultSchema } from "@/api/types/parsing";

export async function getIdentification(
  processId: string,
  runId?: string,
  signal?: AbortSignal,
  resolvedInputHash?: string,
) {
  const response = await apiClient.get<unknown>(
    `/v1/processes/${processId}/documents`,
    {
      params:
        runId || resolvedInputHash
          ? {
              ...(runId ? { run_id: runId } : {}),
              ...(resolvedInputHash
                ? { resolved_input_hash: resolvedInputHash }
                : {}),
            }
          : undefined,
      signal,
    },
  );
  const result = identificationRegistrySchema.parse(response.data);
  if (
    result.process_id !== processId ||
    (runId && result.run_id !== runId) ||
    (resolvedInputHash && result.resolved_input_hash !== resolvedInputHash)
  )
    throw new ApiError("Получен результат другого запуска. Обновите реестр.", {
      status: 409,
    });
  return result;
}

export async function getIdentificationDocument(
  processId: string,
  runId: string,
  documentId: string,
  signal?: AbortSignal,
  resolvedInputHash?: string,
) {
  const response = await apiClient.get<unknown>(
    `/v1/processes/${processId}/documents/${documentId}`,
    {
      params: {
        run_id: runId,
        ...(resolvedInputHash
          ? { resolved_input_hash: resolvedInputHash }
          : {}),
      },
      signal,
    },
  );
  const result = identificationDetailSchema.parse(response.data);
  if (
    result.process_id !== processId ||
    result.run_id !== runId ||
    (resolvedInputHash && result.resolved_input_hash !== resolvedInputHash) ||
    result.document.document_id !== documentId
  )
    throw new ApiError(
      "Карточка относится к другому запуску. Обновите реестр.",
      { status: 409 },
    );
  return result;
}

export async function applyIdentification(
  processId: string,
  input: ClarificationBatch,
) {
  const response = await apiClient.post<unknown>(
    `/v1/processes/${processId}/document-resolutions`,
    clarificationBatchSchema.parse(input),
  );
  const result = clarificationResultSchema.parse(response.data);
  if (
    result.process_id !== processId ||
    result.request_id !== input.request_id ||
    result.previous_run_id !== input.expected_run_id
  )
    throw new ApiError(
      "Не удалось подтвердить результат изменений. Обновите реестр перед повтором.",
      { status: 409 },
    );
  return result;
}

export async function getIdentificationEvidence(
  objectId: string,
  runId: string,
  evidence: IdentificationEvidence,
  signal?: AbortSignal,
) {
  const response = await apiClient.get<unknown>(
    `/v1/objects/${objectId}/files/${evidence.file_id}/parse`,
    { params: { artifact_id: evidence.artifact_id, run_id: runId }, signal },
  );
  const result = parseResultSchema.parse(response.data);
  if (
    result.run_id !== runId ||
    result.artifact_id !== evidence.artifact_id ||
    result.file_id !== evidence.file_id ||
    result.artifact.source_sha256 !== evidence.source_sha256
  )
    throw new ApiError(
      "Источник изменился. Показана сохранённая цитата; другую редакцию подставить нельзя.",
      { status: 409 },
    );
  return result;
}
