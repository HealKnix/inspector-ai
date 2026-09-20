import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { getEvidenceGroups, getExtractions } from "@/api/endpoints/extraction";
import { ApiError } from "@/api/errors";
import { queryKeys } from "@/api/query-keys";
import type { ExtractionStatus } from "@/api/types/extraction";

const subscribeAvailability = (notify: () => void) => {
  document.addEventListener("visibilitychange", notify);
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    document.removeEventListener("visibilitychange", notify);
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
};

function isPermanentError(error: unknown) {
  return (
    error instanceof ApiError && (error.status === 401 || error.status === 403)
  );
}

export function extractionErrorMessage(error: unknown) {
  if (isPermanentError(error)) return "Нет доступа к результатам извлечения.";
  return "Не удалось получить результаты извлечения. Повторите запрос.";
}

export function extractionInterval(
  data: ExtractionStatus | undefined,
  error: unknown,
  available: boolean,
  parsingActive: boolean,
) {
  if (!available || error || (!data?.active && !parsingActive)) return false;
  return Math.max(1000, data?.poll_after_ms ?? 2000);
}

export function useExtractions(
  objectId: string,
  parsingActive: boolean,
  enabled = true,
) {
  const available = useSyncExternalStore(
    subscribeAvailability,
    () => document.visibilityState !== "hidden" && navigator.onLine,
    () => true,
  );
  return useQuery({
    queryKey: queryKeys.objects.extractions(objectId),
    queryFn: ({ signal }) => getExtractions(objectId, signal),
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
      extractionInterval(
        query.state.data,
        query.state.error,
        available,
        parsingActive,
      ),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: (query) => !isPermanentError(query.state.error),
    refetchOnReconnect: (query) => !isPermanentError(query.state.error),
  });
}

export function useEvidenceGroups(objectId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.objects.evidenceGroups(objectId),
    queryFn: ({ signal }) => getEvidenceGroups(objectId, signal),
    enabled: enabled && Boolean(objectId),
    staleTime: 5_000,
  });
}
