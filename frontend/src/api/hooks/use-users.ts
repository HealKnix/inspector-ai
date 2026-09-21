import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createUser,
  getUsers,
  updateUser,
} from "@/api/endpoints/users";
import { queryKeys } from "@/api/query-keys";
import type { UpdateUserRequest } from "@/api/types/users";

export function useUsers() {
  return useQuery({
    queryKey: queryKeys.users.all,
    queryFn: ({ signal }) => getUsers(signal),
    staleTime: 10_000,
  });
}

function useInvalidateUsers() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: queryKeys.users.all });
}

export function useCreateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: createUser,
    retry: false,
    onSettled: invalidate,
  });
}

export function useUpdateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation({
    mutationFn: ({ id, ...request }: UpdateUserRequest & { id: string }) =>
      updateUser(id, request),
    retry: false,
    onSettled: invalidate,
  });
}
