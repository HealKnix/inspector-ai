import axios, { type InternalAxiosRequestConfig } from "axios";

import { normalizeApiError } from "@/api/errors";
import {
  authSessionResponseSchema,
  type AuthSessionResponse,
} from "@/api/types/auth";
import { useAuthSessionStore } from "@/store/auth-session";

export { ApiError } from "@/api/errors";

const clientConfig = {
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:3000/api",
  headers: { "X-Inspector-Request": "1" },
  timeout: 15_000,
  withCredentials: true,
} as const;

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  authRetry?: boolean;
}

const refreshClient = axios.create(clientConfig);

export const apiClient = axios.create(clientConfig);

const refreshExcludedPaths = [
  "/auth/login",
  "/auth/register",
  "/auth/refresh",
  "/auth/logout",
];

let refreshPromise: Promise<AuthSessionResponse> | null = null;

function isRefreshExcluded(url?: string): boolean {
  if (!url) {
    return false;
  }

  return refreshExcludedPaths.some((path) => url.split("?")[0]?.endsWith(path));
}

function refreshAccessToken(): Promise<AuthSessionResponse> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = refreshClient
    .post<unknown>("/auth/refresh")
    .then((response) => authSessionResponseSchema.parse(response.data))
    .then((session) => {
      useAuthSessionStore
        .getState()
        .setSession(session.accessToken, session.user);
      return session;
    })
    .catch((error: unknown) => {
      useAuthSessionStore.getState().clearSession();
      throw normalizeApiError(error);
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

apiClient.interceptors.request.use((config) => {
  const accessToken = useAuthSessionStore.getState().accessToken;

  if (accessToken) {
    config.headers.set("Authorization", `Bearer ${accessToken}`);
  }

  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error)) {
      throw error;
    }

    const request = error.config as RetryableRequestConfig | undefined;

    if (
      error.response?.status !== 401 ||
      !request ||
      request.authRetry ||
      isRefreshExcluded(request.url)
    ) {
      throw normalizeApiError(error);
    }

    request.authRetry = true;
    await refreshAccessToken();

    return apiClient.request(request);
  },
);
