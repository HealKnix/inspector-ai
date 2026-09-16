import { useMutation, useQuery } from "@tanstack/react-query";

import { getCurrentUser, login, logout, register } from "@/api/endpoints/auth";
import { queryClient } from "@/api/query-client";
import { queryKeys } from "@/api/query-keys";

export function useCurrentUser() {
  return useQuery({
    queryKey: queryKeys.auth.currentUser,
    queryFn: ({ signal }) => getCurrentUser(signal),
    refetchOnWindowFocus: "always",
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function useLogin() {
  return useMutation({
    mutationFn: login,
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.auth.currentUser, user);
    },
  });
}

export function useRegister() {
  return useMutation({
    mutationFn: register,
    onSuccess: (user) => {
      queryClient.setQueryData(queryKeys.auth.currentUser, user);
    },
  });
}

export function useLogout() {
  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.clear();
    },
  });
}
