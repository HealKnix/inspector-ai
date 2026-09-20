import { useAuthSessionStore } from "@/store/auth-session";
import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./errors";

function shouldRetry(failureCount: number, error: unknown) {
  if (error instanceof ApiError && error.status) {
    if (error.status >= 400 && error.status < 500) return false;
  }

  return failureCount < 2;
}

export function createAppQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}

export const queryClient = createAppQueryClient();

useAuthSessionStore.subscribe((state, previous) => {
  if (
    state.user?.id !== previous.user?.id ||
    state.user?.role !== previous.user?.role
  ) {
    // Remove protected data when identity or action permissions change, including refresh.
    void queryClient.cancelQueries({
      predicate: (query) => query.queryKey[0] !== "auth",
    });
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== "auth",
    });
  }
});
