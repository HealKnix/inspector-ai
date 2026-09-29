import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { getClassificationStatus } from "@/api/endpoints/classification";
import { ApiError } from "@/api/errors";
import { classificationStatus } from "@/api/types/classification-test-fixtures";
import type { ParsingStatus } from "@/api/types/parsing";
import {
  parsingObjectId,
  parsingStatus,
} from "@/api/types/parsing-test-fixtures";
import { useClassificationStatus } from "./use-classification";

vi.mock("@/api/endpoints/classification", () => ({
  getClassificationStatus: vi.fn(),
  retryClassification: vi.fn(),
}));
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

function mount(initialParsing: ParsingStatus) {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(
    ({ objectId, parsing }) => useClassificationStatus(objectId, parsing),
    {
      wrapper,
      initialProps: { objectId: parsingObjectId, parsing: initialParsing },
    },
  );
  return { ...view, client };
}

describe("classification polling", () => {
  it("continues until saved document decisions are reflected after classification finishes", async () => {
    vi.useFakeTimers();
    vi.mocked(getClassificationStatus)
      .mockResolvedValueOnce({
        ...classificationStatus,
        active: false,
        review_active: true,
      })
      .mockResolvedValue({
        ...classificationStatus,
        active: false,
        review_active: false,
      });
    const view = mount(parsingStatus);
    await act(() => vi.advanceTimersByTimeAsync(1));
    await act(() => vi.advanceTimersByTimeAsync(2100));
    expect(getClassificationStatus).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(getClassificationStatus).toHaveBeenCalledTimes(2);
    view.unmount();
    view.client.clear();
  });
  it("ожидает результаты при активном чтении и обновляется при публикации нового артефакта", async () => {
    vi.useFakeTimers();
    vi.mocked(getClassificationStatus).mockResolvedValue(classificationStatus);
    const reading: ParsingStatus = {
      ...parsingStatus,
      active: true,
      items: [],
    };
    const view = mount(reading);
    await act(() => vi.advanceTimersByTimeAsync(1));
    await act(() => vi.advanceTimersByTimeAsync(2100));
    expect(getClassificationStatus).toHaveBeenCalledTimes(2);
    view.rerender({ objectId: parsingObjectId, parsing: parsingStatus });
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(getClassificationStatus).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(getClassificationStatus).toHaveBeenCalledTimes(3);
    view.unmount();
    view.client.clear();
  });
  it("приостанавливает запросы без сети и в скрытой вкладке", async () => {
    vi.useFakeTimers();
    vi.mocked(getClassificationStatus).mockResolvedValue({
      ...classificationStatus,
      active: true,
    });
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    const connection = vi
      .spyOn(navigator, "onLine", "get")
      .mockReturnValue(true);
    const view = mount(parsingStatus);
    await act(() => vi.advanceTimersByTimeAsync(1));
    act(() => {
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(getClassificationStatus).toHaveBeenCalledTimes(1);
    act(() => {
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(getClassificationStatus).toHaveBeenCalledTimes(2);
    act(() => {
      connection.mockReturnValue(false);
      window.dispatchEvent(new Event("offline"));
    });
    await act(() => vi.advanceTimersByTimeAsync(5000));
    expect(getClassificationStatus).toHaveBeenCalledTimes(2);
    view.unmount();
    view.client.clear();
  });
  it("останавливается после ошибки доступа даже при активном чтении", async () => {
    vi.mocked(getClassificationStatus).mockRejectedValue(
      new ApiError("synthetic", { status: 403 }),
    );
    const view = mount({ ...parsingStatus, active: true });
    await waitFor(() => expect(view.result.current.isError).toBe(true));
    vi.useFakeTimers();
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(getClassificationStatus).toHaveBeenCalledTimes(1);
    view.unmount();
    view.client.clear();
  });
  it("не переносит результат между объектами и отменяет старый запрос", async () => {
    let oldSignal: AbortSignal | undefined;
    vi.mocked(getClassificationStatus)
      .mockImplementationOnce((_id, signal) => {
        oldSignal = signal;
        return new Promise(() => {});
      })
      .mockResolvedValue(classificationStatus);
    const view = mount(parsingStatus);
    await waitFor(() =>
      expect(getClassificationStatus).toHaveBeenCalledTimes(1),
    );
    const nextId = "99999999-9999-4999-8999-999999999999";
    view.rerender({ objectId: nextId, parsing: parsingStatus });
    expect(view.result.current.data).toBeUndefined();
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    expect(oldSignal?.aborted).toBe(true);
    expect(getClassificationStatus).toHaveBeenLastCalledWith(
      nextId,
      expect.any(AbortSignal),
    );
    view.unmount();
    view.client.clear();
  });
});
