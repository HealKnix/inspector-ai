import axios from "axios";

export interface ApiErrorPayload {
  statusCode?: number;
  code?: string;
  message?: string | string[];
  details?: unknown;
}

export class ApiError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  readonly details?: unknown;

  constructor(
    message: string,
    options: {
      status?: number | null;
      code?: string | null;
      details?: unknown;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "ApiError";
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.details = options.details;
  }
}

function messageFromPayload(payload: ApiErrorPayload | undefined) {
  if (Array.isArray(payload?.message)) return payload.message.join("\n");
  return payload?.message;
}

export function normalizeApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (axios.isAxiosError<ApiErrorPayload>(error)) {
    const axiosError = error;
    const status = axiosError.response?.status ?? null;
    const payload = axiosError.response?.data;

    return new ApiError(
      messageFromPayload(payload) ||
        (status === 0 || !axiosError.response
          ? "Сервер недоступен. Проверьте подключение к сети."
          : "Не удалось выполнить запрос."),
      {
        status,
        code: payload?.code ?? axiosError.code ?? null,
        details: payload?.details,
        cause: error,
      },
    );
  }

  return new ApiError(
    error instanceof Error ? error.message : "Произошла неизвестная ошибка.",
    { cause: error },
  );
}
