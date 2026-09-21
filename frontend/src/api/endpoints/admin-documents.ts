import { apiClient } from "@/api/client";
import { ApiError } from "@/api/errors";
import {
  adminDocumentListSchema,
  adminObjectListSchema,
  type AdminDocumentFilters,
} from "@/api/types/admin-documents";
import { parseResultSchema } from "@/api/types/parsing";

export async function getAdminDocuments(
  filters: AdminDocumentFilters,
  signal?: AbortSignal,
) {
  const response = await apiClient.get<unknown>("/v1/admin/documents", {
    params: {
      user_id: filters.userId || undefined,
      object_id: filters.objectId || undefined,
      q: filters.q || undefined,
      page: filters.page,
    },
    signal,
  });
  return adminDocumentListSchema.parse(response.data);
}

export async function getAdminObjects(signal?: AbortSignal) {
  const response = await apiClient.get<unknown>("/v1/admin/objects", {
    signal,
  });
  return adminObjectListSchema.parse(response.data);
}

export async function getAdminParseResult(
  fileId: string,
  artifactId: string,
  signal?: AbortSignal,
) {
  const response = await apiClient.get<unknown>(
    `/v1/admin/documents/${fileId}/parse`,
    { signal },
  );
  const result = parseResultSchema.parse(response.data);
  if (result.file_id !== fileId || result.artifact_id !== artifactId) {
    throw new ApiError(
      "Результат обработки изменился. Обновите список документов.",
      { status: 409 },
    );
  }
  return result;
}

export async function getAdminRenderedPage(
  fileId: string,
  artifactId: string,
  page: number,
  signal?: AbortSignal,
) {
  const response = await apiClient.get<Blob>(
    `/v1/admin/documents/${fileId}/parse/pages/${page}`,
    {
      signal,
      params: { artifact_id: artifactId },
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
