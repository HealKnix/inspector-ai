import {
  applyIdentification,
  getIdentification,
  getIdentificationDocument,
} from "@/api/endpoints/identification";
import { ApiError } from "@/api/errors";
import { queryKeys } from "@/api/query-keys";
import type { ClarificationBatch } from "@/api/types/identification";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function identificationErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 409)
    return "Карточка или запуск изменились. Обновите реестр и проверьте изменения; сохранённые решения не перезаписаны.";
  if (error instanceof ApiError && [401, 403].includes(error.status ?? 0))
    return "Нет доступа к документам этого объекта.";
  if (error instanceof ApiError && error.status === 400)
    return "Не удалось принять уточнение. Проверьте заполненные сведения и повторите отправку.";
  if (error instanceof ApiError && error.status === 404)
    return "Документ или сохранённый расчёт недоступен. Откройте документы из страницы объекта.";
  return "Не удалось связаться с сервисом или обработать ответ. Введённые сведения сохранены на экране; повторите попытку.";
}
export function useIdentification(
  objectId: string,
  processId: string,
  runId?: string,
  resolvedInputHash?: string,
) {
  return useQuery({
    queryKey: [
      ...queryKeys.objects.identification(objectId),
      processId,
      runId ?? "current",
      resolvedInputHash ?? "latest",
    ],
    queryFn: ({ signal }) =>
      getIdentification(processId, runId, signal, resolvedInputHash),
    enabled: Boolean(objectId && processId),
    retry: false,
    refetchInterval: (query) =>
      query.state.error ? false : query.state.data?.active ? 2000 : false,
  });
}
export function useApplyIdentification(objectId: string, processId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: ClarificationBatch) =>
      applyIdentification(processId, input),
    retry: false,
    onSettled: async () => {
      // Even a lost response may have committed a new Run. Refresh all consumers.
      await client.invalidateQueries({
        queryKey: queryKeys.objects.detail(objectId),
      });
    },
  });
}

export function useIdentificationDocument(
  objectId: string,
  processId: string,
  runId: string,
  documentId?: string,
  resolvedInputHash?: string,
) {
  return useQuery({
    queryKey: [
      ...queryKeys.objects.identification(objectId),
      processId,
      runId,
      resolvedInputHash ?? "latest",
      "document",
      documentId ?? "",
    ],
    queryFn: ({ signal }) =>
      getIdentificationDocument(
        processId,
        runId,
        documentId!,
        signal,
        resolvedInputHash,
      ),
    enabled: Boolean(documentId),
    retry: false,
  });
}
