import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { getParsingStatus } from "@/api/endpoints/parsing";
import { ApiError } from "@/api/errors";
import { parsingStatusSchema } from "@/api/types/parsing";
import {
  parsingObjectId,
  parsingStatus,
} from "@/api/types/parsing-test-fixtures";
import {
  isPermanentParsingError,
  parsingInterval,
  useParsingStatus,
} from "./use-parsing";

vi.mock("@/api/endpoints/parsing", () => ({ getParsingStatus: vi.fn() }));

beforeEach(() => {
  vi.resetAllMocks();
  focusManager.setFocused(true);
  onlineManager.setOnline(true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
});

function mount() {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => useParsingStatus(parsingObjectId), { wrapper });
  return { ...view, client };
}

describe("document polling", () => {
  it("приостанавливает активные запросы в скрытой вкладке и без сети", async () => {
    vi.useFakeTimers();
    vi.mocked(getParsingStatus).mockResolvedValue({
      ...parsingStatus,
      active: true,
    });
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    const connection = vi
      .spyOn(navigator, "onLine", "get")
      .mockReturnValue(true);
    const view = mount();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(getParsingStatus).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(2100));
    expect(getParsingStatus).toHaveBeenCalledTimes(2);
    act(() => {
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(getParsingStatus).toHaveBeenCalledTimes(2);
    act(() => {
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(getParsingStatus).toHaveBeenCalledTimes(3);
    act(() => {
      connection.mockReturnValue(false);
      window.dispatchEvent(new Event("offline"));
    });
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(getParsingStatus).toHaveBeenCalledTimes(3);
    act(() => {
      connection.mockReturnValue(true);
      window.dispatchEvent(new Event("online"));
    });
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(getParsingStatus).toHaveBeenCalledTimes(4);
    view.unmount();
    view.client.clear();
  });
  it("продолжает запросы только при явном active и доступной вкладке", () => {
    expect(
      parsingInterval(
        { ...parsingStatus, active: true, poll_after_ms: 3000 },
        null,
        true,
      ),
    ).toBe(3000);
    expect(parsingInterval(parsingStatus, null, true)).toBe(false);
    expect(
      parsingInterval({ ...parsingStatus, active: true }, null, false),
    ).toBe(false);
    expect(
      parsingInterval(
        { ...parsingStatus, active: true },
        new Error("offline"),
        true,
      ),
    ).toBe(false);
  });
  it.each([
    new ApiError("Нет доступа", { status: 403 }),
    parsingStatusSchema.safeParse({ schema_version: 2 }).error!,
  ])(
    "останавливает интервал и повторы при постоянной ошибке, включая фокус и сеть",
    async (error) => {
      vi.mocked(getParsingStatus)
        .mockResolvedValueOnce({ ...parsingStatus, active: true })
        .mockRejectedValue(error);
      const { result, client, unmount } = mount();
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(isPermanentParsingError(error)).toBe(true);
      await act(() => result.current.refetch());
      await waitFor(() => expect(result.current.isError).toBe(true));
      vi.useFakeTimers();
      act(() => {
        focusManager.setFocused(false);
        onlineManager.setOnline(false);
      });
      act(() => {
        focusManager.setFocused(true);
        onlineManager.setOnline(true);
      });
      await act(() => vi.advanceTimersByTimeAsync(20_000));
      expect(getParsingStatus).toHaveBeenCalledTimes(2);
      unmount();
      client.clear();
    },
  );
  it("восстанавливает состояние новым запросом после повторного открытия", async () => {
    vi.mocked(getParsingStatus).mockResolvedValue(parsingStatus);
    const first = mount();
    await waitFor(() =>
      expect(first.result.current.data?.items[0]?.run_id).toBe(
        parsingStatus.items[0]?.run_id,
      ),
    );
    first.unmount();
    first.client.clear();
    const second = mount();
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(getParsingStatus).toHaveBeenCalledTimes(2);
    second.unmount();
    second.client.clear();
  });
});
