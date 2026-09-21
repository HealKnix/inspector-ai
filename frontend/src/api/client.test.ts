import axios, {
  AxiosError,
  AxiosHeaders,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";

import type { UserDto } from "@/api/types/auth";

const originalAdapter = axios.defaults.adapter;
let adapter: AxiosAdapter;

axios.defaults.adapter = (config) => adapter(config);

const { ApiError, apiClient } = await import("@/api/client");
const { useAuthSessionStore } = await import("@/store/auth-session");

const user = {
  id: "27b43d75-2f24-4ff0-8bd8-d4758cfbd3cb",
  login: "inspector",
  role: "INSPECTOR",
  lastName: "Иванов",
  firstName: "Иван",
  createdAt: "2026-09-16T08:00:00.000Z",
} satisfies UserDto;

function createResponse(
  config: InternalAxiosRequestConfig,
  data: unknown,
  status = 200,
): AxiosResponse {
  return {
    config,
    data,
    headers: new AxiosHeaders(),
    status,
    statusText: status === 200 ? "OK" : "Unauthorized",
  };
}

function rejectUnauthorized(
  config: InternalAxiosRequestConfig,
): Promise<never> {
  const response = createResponse(
    config,
    { message: "Требуется авторизация" },
    401,
  );

  return Promise.reject(
    new AxiosError(
      "Требуется авторизация",
      AxiosError.ERR_BAD_REQUEST,
      config,
      undefined,
      response,
    ),
  );
}

function rejectForbidden(config: InternalAxiosRequestConfig): Promise<never> {
  const response = createResponse(config, { message: "Доступ запрещён" }, 403);

  return Promise.reject(
    new AxiosError(
      "Доступ запрещён",
      AxiosError.ERR_BAD_REQUEST,
      config,
      undefined,
      response,
    ),
  );
}

afterAll(() => {
  axios.defaults.adapter = originalAdapter;
});

beforeEach(() => {
  useAuthSessionStore.getState().clearSession();
});

describe("JWT API client", () => {
  it("adds the access token as Bearer authorization", async () => {
    useAuthSessionStore.getState().setSession("access-token", user);
    adapter = (config) => {
      expect(config.headers.get("Authorization")).toBe("Bearer access-token");
      return Promise.resolve(createResponse(config, { ok: true }));
    };

    await expect(apiClient.get("/protected")).resolves.toMatchObject({
      status: 200,
    });
  });

  it("uses one refresh request for concurrent 401 responses", async () => {
    let releaseRefresh: (() => void) | undefined;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let refreshCount = 0;
    let protectedCount = 0;

    adapter = async (config) => {
      if (config.url === "/auth/refresh") {
        refreshCount += 1;
        await refreshGate;
        return createResponse(config, {
          accessToken: "rotated-token",
          user,
        });
      }

      protectedCount += 1;

      if (config.headers.get("Authorization") === "Bearer rotated-token") {
        return createResponse(config, { ok: true });
      }

      return rejectUnauthorized(config);
    };

    const requests = [
      apiClient.get("/protected/one"),
      apiClient.get("/protected/two"),
    ];

    await vi.waitFor(() => {
      expect(refreshCount).toBe(1);
    });
    releaseRefresh?.();

    await expect(Promise.all(requests)).resolves.toHaveLength(2);
    expect(refreshCount).toBe(1);
    expect(protectedCount).toBe(4);
    expect(useAuthSessionStore.getState().accessToken).toBe("rotated-token");
  });

  it("retries the original request only once", async () => {
    let refreshCount = 0;
    let protectedCount = 0;

    adapter = async (config) => {
      if (config.url === "/auth/refresh") {
        refreshCount += 1;
        return createResponse(config, {
          accessToken: "rotated-token",
          user,
        });
      }

      protectedCount += 1;
      return rejectUnauthorized(config);
    };

    await expect(apiClient.get("/protected")).rejects.toBeInstanceOf(ApiError);
    expect(refreshCount).toBe(1);
    expect(protectedCount).toBe(2);
  });

  it("does not refresh after a login failure", async () => {
    let refreshCount = 0;

    adapter = (config) => {
      if (config.url === "/auth/refresh") {
        refreshCount += 1;
      }

      return rejectUnauthorized(config);
    };

    await expect(apiClient.post("/auth/login", {})).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(refreshCount).toBe(0);
  });

  it("does not refresh after a non-401 response", async () => {
    let refreshCount = 0;

    adapter = (config) => {
      if (config.url === "/auth/refresh") {
        refreshCount += 1;
      }

      return rejectForbidden(config);
    };

    await expect(apiClient.get("/forbidden")).rejects.toBeInstanceOf(ApiError);
    expect(refreshCount).toBe(0);
  });
});
