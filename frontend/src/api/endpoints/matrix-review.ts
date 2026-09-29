import { apiClient } from "@/api/client";
import {
  matrixReviewContractSchema,
  matrixReviewSchema,
  passportMutationSchema,
  regressionMutationSchema,
  type PassportInput,
  type RegressionInput,
} from "@/api/types/matrix-review";

export async function getMatrixReviewContract(signal?: AbortSignal) {
  const response = await apiClient.get<unknown>(
    "/v1/admin/matrix/review-contract",
    { signal },
  );
  return matrixReviewContractSchema.parse(response.data);
}
export async function getMatrixReview(ruleId: string, signal?: AbortSignal) {
  const response = await apiClient.get<unknown>(
    `/v1/admin/matrix/rules/${encodeURIComponent(ruleId)}/review`,
    { signal },
  );
  return matrixReviewSchema.parse(response.data);
}
export async function saveMatrixPassport(input: {
  ruleId: string;
  passport: PassportInput;
}) {
  const response = await apiClient.post<unknown>(
    `/v1/admin/matrix/rules/${encodeURIComponent(input.ruleId)}/passport`,
    input.passport,
  );
  return passportMutationSchema.parse(response.data);
}
export async function runMatrixRegression(input: {
  ruleId: string;
  regression: RegressionInput;
}) {
  const response = await apiClient.post<unknown>(
    `/v1/admin/matrix/rules/${encodeURIComponent(input.ruleId)}/regression`,
    input.regression,
  );
  return regressionMutationSchema.parse(response.data);
}
