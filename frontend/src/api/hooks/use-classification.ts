import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { ZodError } from "zod";

import {
  getClassificationStatus,
  getKindOptions,
  resolveClassification,
  retryClassification,
} from "@/api/endpoints/classification";
import { ApiError } from "@/api/errors";
import { queryKeys } from "@/api/query-keys";
import type { ClassificationStatus } from "@/api/types/classification";
import type { ParsingStatus } from "@/api/types/parsing";

function subscribeAvailability(callback: () => void) {
  document.addEventListener("visibilitychange", callback);
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    document.removeEventListener("visibilitychange", callback);
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function isPermanentError(error: unknown) {
  return (
    error instanceof ZodError ||
    (error instanceof ApiError &&
      error.status !== null &&
      error.status >= 400 &&
      error.status < 500)
  );
}

export function classificationErrorMessage(error: unknown) {
  if (error instanceof ZodError)
    return "Сервер вернул неизвестный формат классификации. Обновление остановлено.";
  if (
    error instanceof ApiError &&
    (error.status === 401 || error.status === 403)
  )
    return "Нет доступа к классификации документов.";
  if (error instanceof ApiError && error.status === 409)
    return "Результат обработки изменился. Обновите состояние документов.";
  return "Не удалось получить классификацию. Повторите запрос.";
}

export function classificationInterval(
  data: ClassificationStatus | undefined,
  error: unknown,
  available: boolean,
  parsingActive: boolean,
) {
  if (
    !available ||
    error ||
    (!data?.active && !data?.review_active && !parsingActive)
  )
    return false;
  return Math.max(1000, data?.poll_after_ms ?? 2000);
}

export function useClassificationStatus(
  objectId: string,
  parsing: ParsingStatus | undefined,
  enabled = true,
  resolvedInputHash?: string | null,
) {
  const available = useSyncExternalStore(
    subscribeAvailability,
    () => document.visibilityState !== "hidden" && navigator.onLine,
    () => true,
  );
  // A newly published parse artifact must be queried even if both workers finish between polls.
  const parsingIdentity =
    parsing?.items
      .map(
        (file) =>
          `${file.file_id}:${file.run_id}:${file.artifact_id ?? ""}:${file.state}`,
      )
      .join("|") ?? "";
  return useQuery({
    queryKey: [
      ...queryKeys.objects.classification(objectId),
      parsingIdentity,
      resolvedInputHash ?? "latest",
    ],
    queryFn: ({ signal }) => getClassificationStatus(objectId, signal),
    enabled: (query) =>
      enabled &&
      Boolean(objectId) &&
      available &&
      !isPermanentError(query.state.error),
    staleTime: 0,
    gcTime: 0,
    retry: (attempt, error) =>
      available && !isPermanentError(error) && attempt < 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    refetchInterval: (query) =>
      classificationInterval(
        query.state.data,
        query.state.error,
        available,
        parsing?.active ?? false,
      ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: (query) => !isPermanentError(query.state.error),
    refetchOnReconnect: (query) => !isPermanentError(query.state.error),
  });
}

export function useRetryClassification() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: retryClassification,
    retry: false,
    onSettled: async (_data, _error, input) => {
      await client.invalidateQueries({
        queryKey: queryKeys.objects.classification(input.objectId),
      });
    },
  });
}

export function useKindOptions(objectId: string, enabled = true) {
  return useQuery({
    queryKey: [...queryKeys.objects.classification(objectId), "kind-options"],
    queryFn: ({ signal }) => getKindOptions(objectId, signal),
    enabled: enabled && Boolean(objectId),
    staleTime: 5 * 60_000,
    retry: (attempt, error) => !isPermanentError(error) && attempt < 2,
  });
}

export function useResolveClassification() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: resolveClassification,
    retry: false,
    onSettled: async (_data, _error, input) => {
      await client.invalidateQueries({
        queryKey: queryKeys.objects.detail(input.objectId),
      });
    },
  });
}
