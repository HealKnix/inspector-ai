import { apiClient } from "@/api/client";
import { userSchema } from "@/api/types/auth";
import {
  adminUsersSchema,
  type CreateUserRequest,
  type UpdateUserRequest,
} from "@/api/types/users";

export async function getUsers(signal?: AbortSignal) {
  const response = await apiClient.get<unknown>("/v1/admin/users", { signal });
  return adminUsersSchema.parse(response.data);
}

export async function createUser(request: CreateUserRequest) {
  const response = await apiClient.post<unknown>("/v1/admin/users", request);
  return userSchema.parse(response.data);
}

export async function updateUser(id: string, request: UpdateUserRequest) {
  const response = await apiClient.patch<unknown>(
    `/v1/admin/users/${id}`,
    request,
  );
  return userSchema.parse(response.data);
}
