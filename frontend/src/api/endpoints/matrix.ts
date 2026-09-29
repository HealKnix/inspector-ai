import { apiClient } from "@/api/client";
import {
  dryRunResultSchema,
  matrixRowDetailSchema,
  matrixRowsSchema,
  matrixSearchSchema,
  ruleMutationSchema,
} from "@/api/types/matrix";

export async function getMatrixRows(signal?: AbortSignal) {
  const response = await apiClient.get<unknown>("/v1/admin/matrix/rows", {
    signal,
  });
  return matrixRowsSchema.parse(response.data);
}

export async function getMatrixRules(
  parameterCode: string,
  signal?: AbortSignal,
) {
  const response = await apiClient.get<unknown>(
    `/v1/admin/matrix/rows/${encodeURIComponent(parameterCode)}/rules`,
    { signal },
  );
  return matrixRowDetailSchema.parse(response.data);
}

export async function createMatrixRule(input: {
  parameterCode: string;
  plan: unknown;
  comparison?: unknown;
  note?: string;
}) {
  const response = await apiClient.post<unknown>(
    `/v1/admin/matrix/rows/${encodeURIComponent(input.parameterCode)}/rules`,
    { plan: input.plan, comparison: input.comparison, note: input.note },
  );
  return ruleMutationSchema.parse(response.data);
}

export async function draftMatrixRuleLlm(input: {
  parameterCode: string;
  object_id: string;
  file_id?: string;
  terms?: string[];
}) {
  const response = await apiClient.post<unknown>(
    `/v1/admin/matrix/rows/${encodeURIComponent(input.parameterCode)}/draft-llm`,
    {
      object_id: input.object_id,
      file_id: input.file_id,
      terms: input.terms,
    },
  );
  return ruleMutationSchema.parse(response.data);
}

export async function dryRunMatrixRule(input: {
  ruleId: string;
  object_id: string;
  file_id?: string;
}) {
  const response = await apiClient.post<unknown>(
    `/v1/admin/matrix/rules/${input.ruleId}/dry-run`,
    { object_id: input.object_id, file_id: input.file_id },
  );
  return dryRunResultSchema.parse(response.data);
}

export async function approveMatrixRule(ruleId: string) {
  const response = await apiClient.post<unknown>(
    `/v1/admin/matrix/rules/${ruleId}/approve`,
  );
  return ruleMutationSchema.parse(response.data);
}

export async function rejectMatrixRule(ruleId: string) {
  const response = await apiClient.post<unknown>(
    `/v1/admin/matrix/rules/${ruleId}/reject`,
  );
  return ruleMutationSchema.parse(response.data);
}

export async function searchMatrixContext(input: {
  object_id: string;
  file_id?: string;
  terms: string[];
}) {
  const response = await apiClient.post<unknown>(
    "/v1/admin/matrix/search",
    input,
  );
  return matrixSearchSchema.parse(response.data);
}
