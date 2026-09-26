import { apiClient } from "@/api/client";
import { ApiError } from "@/api/errors";
import { parseResultSchema, parsingStatusSchema } from "@/api/types/parsing";

export async function getParsingStatus(objectId: string, signal?: AbortSignal) {
  const response = await apiClient.get<unknown>(
    `/v1/objects/${objectId}/parsing`,
    { signal },
  );
  return parsingStatusSchema.parse(response.data);
}

export async function getParseResult(
  objectId: string,
  fileId: string,
  runId: string,
  artifactId: string,
  signal?: AbortSignal,
) {
  const response = await apiClient.get<unknown>(
    `/v1/objects/${objectId}/files/${fileId}/parse`,
    { signal, params: { run_id: runId, artifact_id: artifactId } },
  );
  const result = parseResultSchema.parse(response.data);
  if (
    result.file_id !== fileId ||
    result.run_id !== runId ||
    result.artifact_id !== artifactId
  ) {
    throw new ApiError(
      "Результат обработки изменился. Обновите состояние документов.",
      { status: 409 },
    );
  }
  return result;
}

export async function getRenderedPage(
  objectId: string,
  fileId: string,
  artifactId: string,
  page: number,
  signal?: AbortSignal,
  runId?: string,
) {
  const response = await apiClient.get<Blob>(
    `/v1/objects/${objectId}/files/${fileId}/parse/pages/${page}`,
    {
      signal,
      params: { artifact_id: artifactId, ...(runId ? { run_id: runId } : {}) },
      responseType: "blob",
      timeout: 60_000,
    },
  );
  if (response.data.type !== "image/png") {
    throw new ApiError("Не удалось прочитать изображение страницы.", {
      status: 422,
    });
  }
  return response.data;
}

export async function retryParsing(input: {
  objectId: string;
  fileId: string;
  requestId: string;
}) {
  await apiClient.post(
    `/v1/objects/${input.objectId}/files/${input.fileId}/parse/retry`,
    {
      request_id: input.requestId,
    },
  );
}
