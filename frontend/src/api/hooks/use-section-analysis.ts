import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { ZodError } from "zod";

import {
  getSectionAnalysisStatus,
  startSectionAnalysis,
} from "@/api/endpoints/section-analysis";
import { ApiError } from "@/api/errors";
import { queryKeys } from "@/api/query-keys";
import type {
  SectionAnalysisStartRequest,
  SectionAnalysisStatus,
} from "@/api/types/section-analysis";

function subscribeAvailability(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  document.addEventListener("visibilitychange", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
    document.removeEventListener("visibilitychange", callback);
  };
}

function clientAvailable() {
  return (
    typeof document === "undefined" ||
    typeof navigator === "undefined" ||
    (document.visibilityState !== "hidden" && navigator.onLine)
  );
}

const PERMANENT_STATUSES = new Set([400, 401, 403, 404]);

/** Client/data problems where polling again cannot help. */
export function isPermanentSectionError(error: unknown) {
  if (error instanceof ZodError) return true;
  return (
    error instanceof ApiError &&
    error.status !== null &&
    PERMANENT_STATUSES.has(error.status)
  );
}

/** Poll only while the selected task is queued/processing. */
export function sectionAnalysisInterval(
  status: SectionAnalysisStatus | undefined,
  error: Error | null,
  available: boolean,
) {
  if (!available || error || !status?.active) return false;
  return Math.max(1000, status.poll_after_ms);
}

/**
 * Latest section-analysis state for the object's current run. `runId` pins a
 * specific run when needed; omitted the server resolves the current one.
 */
export function useSectionAnalysis(
  objectId: string | undefined,
  runId?: string,
  enabled = true,
) {
  const available = useSyncExternalStore(
    subscribeAvailability,
    clientAvailable,
  );
  const client = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.objects.sectionAnalysis(objectId ?? "", runId),
    queryFn: ({ signal }) =>
      getSectionAnalysisStatus(objectId as string, runId, signal),
    enabled: (query) =>
      Boolean(objectId) &&
      enabled &&
      available &&
      !isPermanentSectionError(query.state.error),
    retry: (attempt, error) =>
      available && !isPermanentSectionError(error) && attempt < 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    refetchInterval: (query) =>
      sectionAnalysisInterval(query.state.data, query.state.error, available),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: (query) =>
      !isPermanentSectionError(query.state.error),
    refetchOnReconnect: (query) => !isPermanentSectionError(query.state.error),
  });
  // The selected task basis is authoritative: a terminal transition, a
  // different admitted task or a freshness flag flip (task.stale, current,
  // enabled, run/hash change) can all change what the protocol/findings
  // must reflect — refresh those queries once per observed signature.
  const status = query.data;
  const observedKey = status
    ? [
        status.enabled ? 1 : 0,
        status.current ? 1 : 0,
        status.run_id ?? "-",
        status.resolved_input_hash ?? "-",
        status.task?.id ?? "-",
        status.task?.state ?? "-",
        status.task?.stale ? 1 : 0,
        status.task?.source_fingerprint ?? "-",
      ].join(":")
    : "";
  const previous = useRef<{ objectId: string; key: string } | null>(null);
  useEffect(() => {
    if (!objectId) return;
    const prev = previous.current;
    previous.current = { objectId, key: observedKey };
    if (
      !prev ||
      prev.objectId !== objectId ||
      !observedKey ||
      prev.key === observedKey
    )
      return;
    void client.invalidateQueries({
      queryKey: queryKeys.objects.protocol(objectId),
    });
    void client.invalidateQueries({
      queryKey: queryKeys.objects.findings(objectId),
    });
  }, [client, objectId, observedKey]);
  return query;
}

/**
 * Idempotent start admission. A fresh `request_id` selects the basis;
 * replaying an existing one returns its receipt without re-queuing.
 */
export function useStartSectionAnalysis(objectId: string | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: SectionAnalysisStartRequest) =>
      startSectionAnalysis(objectId as string, body),
    onSettled: () => {
      if (!objectId) return;
      // The admission decides which task is selected; status polling picks
      // the queue up, while protocol/findings refresh once results land.
      void client.invalidateQueries({
        queryKey: ["objects", objectId, "section-analysis"],
      });
      void client.invalidateQueries({
        queryKey: queryKeys.objects.protocol(objectId),
      });
      void client.invalidateQueries({
        queryKey: queryKeys.objects.findings(objectId),
      });
    },
  });
}

export function sectionAnalysisStatusErrorMessage(error: unknown) {
  if (error instanceof ZodError) {
    return "Сервер вернул состояние анализа разделов в неподдерживаемом формате.";
  }
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return "Нет доступа к анализу разделов этого объекта.";
    }
    if (error.status === 404) {
      return "Обработка для анализа разделов не найдена. Обновите страницу.";
    }
    if (error.status === 400) {
      return "Сервер отклонил запрос состояния анализа разделов.";
    }
  }
  return "Не удалось получить состояние анализа разделов. Повторите запрос.";
}

export function sectionAnalysisStartErrorMessage(error: unknown) {
  if (error instanceof ZodError) {
    return "Сервер подтвердил запуск анализа в неподдерживаемом формате.";
  }
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return "Нет прав на запуск анализа разделов этого объекта.";
    }
    if (error.status === 400 || error.status === 404 || error.status === 409) {
      // The service replies with user-facing Russian wording for body,
      // concurrency and feature-gate conflicts.
      return error.message;
    }
  }
  return "Не удалось запустить анализ разделов. Попробуйте ещё раз.";
}
