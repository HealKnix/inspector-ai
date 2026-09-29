import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  finalizeProtocol,
  generateProtocol,
  getFinding,
  getProtocol,
  listFindings,
  postDecision,
} from "@/api/endpoints/verification";
import { ApiError } from "@/api/errors";
import { queryKeys } from "@/api/query-keys";
import type { DecisionRequest } from "@/api/types/verification";

function isPermanentError(error: unknown) {
  return (
    error instanceof ApiError && (error.status === 401 || error.status === 403)
  );
}

export function verificationErrorMessage(error: unknown) {
  if (isPermanentError(error)) {
    return "Нет доступа к протоколу проверки этого объекта.";
  }
  return "Не удалось получить данные проверки. Повторите запрос.";
}

export function useProtocol(
  objectId: string,
  enabled = true,
  protocolId?: string,
) {
  return useQuery({
    queryKey: [
      ...queryKeys.objects.protocol(objectId),
      ...(protocolId ? [protocolId] : []),
    ],
    queryFn: ({ signal }) => getProtocol(objectId, signal, protocolId),
    enabled: enabled && Boolean(objectId),
    staleTime: 0,
    retry: (attempt, error) => !isPermanentError(error) && attempt < 2,
  });
}

export function useFindings(
  objectId: string,
  enabled = true,
  protocolId?: string,
) {
  return useQuery({
    queryKey: [
      ...queryKeys.objects.findings(objectId),
      ...(protocolId ? [protocolId] : []),
    ],
    queryFn: ({ signal }) =>
      listFindings(
        objectId,
        protocolId ? { protocol_id: protocolId } : {},
        signal,
      ),
    enabled: enabled && Boolean(objectId),
    staleTime: 0,
    retry: (attempt, error) => !isPermanentError(error) && attempt < 2,
  });
}

export function useFinding(
  objectId: string,
  findingId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.objects.finding(objectId, findingId ?? ""),
    queryFn: ({ signal }) => getFinding(objectId, findingId!, signal),
    enabled: enabled && Boolean(objectId) && Boolean(findingId),
    staleTime: 0,
    retry: (attempt, error) => !isPermanentError(error) && attempt < 2,
  });
}

export function useVerificationMutations(objectId: string) {
  const client = useQueryClient();
  const invalidate = () =>
    Promise.all([
      client.invalidateQueries({
        queryKey: queryKeys.objects.protocol(objectId),
      }),
      client.invalidateQueries({
        queryKey: queryKeys.objects.findings(objectId),
      }),
    ]);

  const decide = useMutation({
    mutationFn: ({
      findingId,
      body,
    }: {
      findingId: string;
      body: DecisionRequest;
    }) => postDecision(objectId, findingId, body),
    onSuccess: invalidate,
  });

  const generate = useMutation({
    mutationFn: () => generateProtocol(objectId),
    onSuccess: invalidate,
  });

  const finalize = useMutation({
    mutationFn: () => finalizeProtocol(objectId),
    onSuccess: invalidate,
  });

  return { decide, generate, finalize };
}
