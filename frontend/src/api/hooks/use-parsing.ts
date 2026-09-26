import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { ZodError } from "zod";

import {
  getParseResult,
  getParsingStatus,
  getRenderedPage,
  retryParsing,
} from "@/api/endpoints/parsing";
import { ApiError } from "@/api/errors";
import { queryKeys } from "@/api/query-keys";
import type { ParsingFile, ParsingStatus } from "@/api/types/parsing";

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

export function isPermanentParsingError(error: unknown) {
  return (
    error instanceof ZodError ||
    (error instanceof ApiError &&
      error.status !== null &&
      error.status >= 400 &&
      error.status < 500)
  );
}

export function parsingInterval(
  data: ParsingStatus | undefined,
  error: unknown,
  available: boolean,
) {
  if (!available || error || !data?.active) return false;
  return Math.max(1000, data.poll_after_ms);
}

export function parsingErrorMessage(error: unknown) {
  if (error instanceof ZodError)
    return "Сервер вернул неизвестный формат обработки. Обновление остановлено.";
  return error instanceof Error
    ? error.message
    : "Не удалось получить результат обработки.";
}

export function useParsingStatus(objectId: string, enabled = true) {
  const available = useSyncExternalStore(
    subscribeAvailability,
    () => document.visibilityState !== "hidden" && navigator.onLine,
    () => true,
  );
  return useQuery({
    queryKey: queryKeys.objects.parsing(objectId),
    queryFn: ({ signal }) => getParsingStatus(objectId, signal),
    enabled: (query) =>
      enabled &&
      Boolean(objectId) &&
      available &&
      !isPermanentParsingError(query.state.error),
    staleTime: 0,
    retry: (attempt, error) =>
      available && !isPermanentParsingError(error) && attempt < 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    refetchInterval: (query) =>
      parsingInterval(query.state.data, query.state.error, available),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: (query) =>
      !isPermanentParsingError(query.state.error),
    refetchOnReconnect: (query) => !isPermanentParsingError(query.state.error),
  });
}

export function useParseResult(objectId: string, file: ParsingFile) {
  return useQuery({
    queryKey: queryKeys.objects.parse(
      objectId,
      file.file_id,
      file.run_id,
      file.artifact_id ?? "",
    ),
    queryFn: ({ signal }) =>
      getParseResult(
        objectId,
        file.file_id,
        file.run_id,
        file.artifact_id!,
        signal,
      ),
    enabled: file.state === "succeeded" && Boolean(file.artifact_id),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: 0,
  });
}

export function useRenderedPage(
  objectId: string,
  file: ParsingFile,
  page: number,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.objects.renderedPage(
      objectId,
      file.file_id,
      file.run_id,
      file.artifact_id ?? "",
      page,
    ),
    queryFn: ({ signal }) =>
      getRenderedPage(
        objectId,
        file.file_id,
        file.artifact_id!,
        page,
        signal,
        file.run_id,
      ),
    enabled: enabled && Boolean(file.artifact_id) && page > 0,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: 0,
  });
}

export function useRetryParsing() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: retryParsing,
    retry: false,
    onSettled: async (_data, _error, input) => {
      // A lost response does not mean the server rejected the retry.
      await client.invalidateQueries({
        queryKey: queryKeys.objects.parsing(input.objectId),
      });
    },
  });
}
