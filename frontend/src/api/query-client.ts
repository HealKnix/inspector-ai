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
