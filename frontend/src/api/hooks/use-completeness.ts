import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ZodError } from "zod";

import {
  confirmExpectedPackage,
  evaluateCompleteness,
  generateExpectedPackage,
  getCompletenessResult,
  getExpectedPackage,
} from "@/api/endpoints/completeness";
import { ApiError } from "@/api/errors";
import { queryKeys } from "@/api/query-keys";

function isPermanentError(error: unknown) {
  return (
    error instanceof ZodError ||
    (error instanceof ApiError &&
      error.status !== null &&
      error.status >= 400 &&
      error.status < 500)
  );
}

export function completenessErrorMessage(error: unknown) {
  if (error instanceof ZodError)
    return "Сервер вернул неизвестный формат комплектности. Обновление остановлено.";
  if (
    error instanceof ApiError &&
    (error.status === 401 || error.status === 403)
  )
    return "Нет доступа к комплектности объекта.";
  if (error instanceof ApiError && error.status === 409)
    return "Состав или каркас изменились. Обновите перечень и повторите.";
  return "Не удалось получить комплектность. Повторите запрос.";
}

export function useExpectedPackage(objectId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.objects.completenessPackage(objectId),
    queryFn: ({ signal }) => getExpectedPackage(objectId, signal),
    enabled: (query) =>
      enabled && Boolean(objectId) && !isPermanentError(query.state.error),
    staleTime: 0,
    gcTime: 0,
    retry: (attempt, error) => !isPermanentError(error) && attempt < 2,
  });
}

export function useCompletenessResult(
  objectId: string,
  runId: string | undefined,
  enabled = true,
  resolvedInputHash?: string | null,
) {
  return useQuery({
    queryKey: [
      ...queryKeys.objects.completenessResult(objectId, runId),
      resolvedInputHash ?? "latest",
    ],
    queryFn: ({ signal }) => getCompletenessResult(objectId, runId, signal),
    enabled: (query) =>
      enabled && Boolean(objectId) && !isPermanentError(query.state.error),
    staleTime: 0,
    gcTime: 0,
    retry: (attempt, error) => !isPermanentError(error) && attempt < 2,
  });
}

function useInvalidateCompleteness(objectId: string) {
  const client = useQueryClient();
  return () =>
    client.invalidateQueries({
      queryKey: ["objects", objectId, "completeness"],
    });
}

export function useGeneratePackage(objectId: string) {
  const invalidate = useInvalidateCompleteness(objectId);
  return useMutation({
    mutationFn: (
      input: Omit<Parameters<typeof generateExpectedPackage>[0], "objectId">,
    ) => generateExpectedPackage({ ...input, objectId }),
    retry: false,
    onSettled: invalidate,
  });
}

export function useConfirmPackage(objectId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (
      input: Omit<Parameters<typeof confirmExpectedPackage>[0], "objectId">,
    ) => confirmExpectedPackage({ ...input, objectId }),
    retry: false,
    onSettled: () =>
      client.invalidateQueries({
        queryKey: queryKeys.objects.detail(objectId),
      }),
  });
}

export function useEvaluateCompleteness(objectId: string) {
  const invalidate = useInvalidateCompleteness(objectId);
  return useMutation({
    mutationFn: (runId?: string) => evaluateCompleteness({ objectId, runId }),
    retry: false,
    onSettled: invalidate,
  });
}
