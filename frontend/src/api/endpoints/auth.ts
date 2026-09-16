import type { AxiosResponse } from "axios";

import { ApiError, apiClient } from "@/api/client";
import {
  authSessionResponseSchema,
  currentUserResponseSchema,
  type LoginRequest,
  type RegisterRequest,
  type UserDto,
} from "@/api/types/auth";
import { useAuthSessionStore } from "@/store/auth-session";

function applySessionResponse(data: unknown): UserDto {
  const session = authSessionResponseSchema.parse(data);
  useAuthSessionStore.getState().setSession(session.accessToken, session.user);
  return session.user;
}

export async function login(request: LoginRequest): Promise<UserDto> {
  const response: AxiosResponse<unknown> = await apiClient.post(
    "/auth/login",
    request,
  );
  return applySessionResponse(response.data);
}

export async function register(request: RegisterRequest): Promise<UserDto> {
  const response: AxiosResponse<unknown> = await apiClient.post(
    "/auth/register",
    request,
  );
  return applySessionResponse(response.data);
}

export async function getCurrentUser(
  signal?: AbortSignal,
): Promise<UserDto | null> {
  try {
    const response: AxiosResponse<unknown> = await apiClient.get("/auth/me", {
      signal,
    });
    const user = currentUserResponseSchema.parse(response.data).user;
    useAuthSessionStore.getState().setUser(user);
    return user;
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      useAuthSessionStore.getState().clearSession();
      return null;
    }

    throw error;
  } finally {
    useAuthSessionStore.getState().setInitialized(true);
  }
}

export async function logout(): Promise<void> {
  try {
    await apiClient.post("/auth/logout");
    useAuthSessionStore.getState().clearSession();
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === 401) {
      useAuthSessionStore.getState().clearSession();
      return;
    }

    throw error;
  }
}
