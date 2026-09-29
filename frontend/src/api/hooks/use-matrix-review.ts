import {
  getMatrixReview,
  getMatrixReviewContract,
  runMatrixRegression,
  saveMatrixPassport,
} from "@/api/endpoints/matrix-review";
import { queryKeys } from "@/api/query-keys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useMatrixReviewContract() {
  return useQuery({
    queryKey: queryKeys.matrix.reviewContract,
    queryFn: ({ signal }) => getMatrixReviewContract(signal),
  });
}
export function useMatrixReview(ruleId: string) {
  return useQuery({
    queryKey: queryKeys.matrix.review(ruleId),
    queryFn: ({ signal }) => getMatrixReview(ruleId, signal),
  });
}
export function useSaveMatrixPassport() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: saveMatrixPassport,
    retry: false,
    onSettled: () =>
      client.invalidateQueries({ queryKey: queryKeys.matrix.all }),
  });
}
export function useRunMatrixRegression() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: runMatrixRegression,
    retry: false,
    onSettled: () =>
      client.invalidateQueries({ queryKey: queryKeys.matrix.all }),
  });
}
