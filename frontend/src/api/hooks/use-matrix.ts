import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  approveMatrixRule,
  createMatrixRule,
  draftMatrixRuleLlm,
  dryRunMatrixRule,
  getMatrixRows,
  getMatrixRules,
  rejectMatrixRule,
  searchMatrixContext,
} from "@/api/endpoints/matrix";
import { queryKeys } from "@/api/query-keys";

export function useMatrixRows(enabled = true) {
  return useQuery({
    queryKey: queryKeys.matrix.rows,
    queryFn: ({ signal }) => getMatrixRows(signal),
    enabled,
    staleTime: 10_000,
  });
}

export function useMatrixRules(parameterCode: string | null) {
  return useQuery({
    queryKey: queryKeys.matrix.rules(parameterCode ?? ""),
    queryFn: ({ signal }) => getMatrixRules(parameterCode ?? "", signal),
    enabled: Boolean(parameterCode),
  });
}

function useInvalidateMatrix() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: queryKeys.matrix.all });
}

export function useCreateMatrixRule() {
  const invalidate = useInvalidateMatrix();
  return useMutation({
    mutationFn: createMatrixRule,
    retry: false,
    onSettled: invalidate,
  });
}

export function useDraftMatrixRuleLlm() {
  const invalidate = useInvalidateMatrix();
  return useMutation({
    mutationFn: draftMatrixRuleLlm,
    retry: false,
    onSettled: invalidate,
  });
}

export function useDryRunMatrixRule() {
  return useMutation({ mutationFn: dryRunMatrixRule, retry: false });
}

export function useApproveMatrixRule() {
  const invalidate = useInvalidateMatrix();
  return useMutation({
    mutationFn: approveMatrixRule,
    retry: false,
    onSettled: invalidate,
  });
}

export function useRejectMatrixRule() {
  const invalidate = useInvalidateMatrix();
  return useMutation({
    mutationFn: rejectMatrixRule,
    retry: false,
    onSettled: invalidate,
  });
}

export function useMatrixSearch() {
  return useMutation({ mutationFn: searchMatrixContext, retry: false });
}
