import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import {
  getSectionAnalysisStatus,
  startSectionAnalysis,
} from "@/api/endpoints/section-analysis";
import { ApiError } from "@/api/errors";
import { queryKeys } from "@/api/query-keys";
import {
  sectionObjectId,
  sectionRequestId,
  sectionRunId,
  sectionStatus,
  sectionTask,
} from "@/api/types/section-analysis-test-fixtures";
import {
  sectionAnalysisInterval,
  useSectionAnalysis,
  useStartSectionAnalysis,
} from "./use-section-analysis";

vi.mock("@/api/endpoints/section-analysis", () => ({
  getSectionAnalysisStatus: vi.fn(),
  startSectionAnalysis: vi.fn(),
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

function mount() {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = renderHook(() => useSectionAnalysis(sectionObjectId), {
    wrapper,
  });
  return { ...view, client, wrapper };
}

describe("section-analysis status polling", () => {
  it("polls only while the selected task is active", async () => {
    vi.useFakeTimers();
    vi.mocked(getSectionAnalysisStatus)
      .mockResolvedValueOnce({
        ...sectionStatus,
        active: true,
        task: { ...sectionTask, state: "processing" },
        results: null,
      })
      .mockResolvedValue(sectionStatus);
    const view = mount();
    await act(() => vi.advanceTimersByTimeAsync(1));
    await act(() => vi.advanceTimersByTimeAsync(2100));
    expect(getSectionAnalysisStatus).toHaveBeenCalledTimes(2);
    // succeeded + inactive stops the interval
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(getSectionAnalysisStatus).toHaveBeenCalledTimes(2);
    view.unmount();
    view.client.clear();
  });

  it("does not poll an empty or failed status", () => {
    expect(
      sectionAnalysisInterval({ ...sectionStatus, active: false }, null, true),
    ).toBe(false);
    expect(
      sectionAnalysisInterval(
        { ...sectionStatus, active: true, poll_after_ms: 500 },
        null,
        true,
      ),
    ).toBe(1000);
    expect(
      sectionAnalysisInterval(
        { ...sectionStatus, active: true },
        new Error("offline"),
        true,
      ),
    ).toBe(false);
    expect(
      sectionAnalysisInterval({ ...sectionStatus, active: true }, null, false),
    ).toBe(false);
  });

  it("stops after an access error instead of retrying forever", async () => {
    vi.mocked(getSectionAnalysisStatus).mockRejectedValue(
      new ApiError("synthetic", { status: 403 }),
    );
    const view = mount();
    await waitFor(() => expect(view.result.current.isError).toBe(true));
    vi.useFakeTimers();
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(getSectionAnalysisStatus).toHaveBeenCalledTimes(1);
    view.unmount();
    view.client.clear();
  });
});

describe("selected-task signature invalidation", () => {
  it("invalidates protocol/findings once per basis change, not per refetch", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const protocolKey = queryKeys.objects.protocol(sectionObjectId);
    const findingsKey = queryKeys.objects.findings(sectionObjectId);
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    vi.mocked(getSectionAnalysisStatus).mockResolvedValue(sectionStatus);
    const view = renderHook(() => useSectionAnalysis(sectionObjectId), {
      wrapper,
    });

    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    // The first observed basis refreshes protocol/findings once.
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: protocolKey });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: findingsKey });
    const baseline = invalidateSpy.mock.calls.length;
    expect(baseline).toBe(2);

    // Same signature refetch — no invalidation.
    await view.result.current.refetch();
    expect(invalidateSpy).toHaveBeenCalledTimes(baseline);

    // task.stale flips — the stored result can no longer be a basis.
    vi.mocked(getSectionAnalysisStatus).mockResolvedValue({
      ...sectionStatus,
      task: { ...sectionTask, stale: true },
    });
    await view.result.current.refetch();
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledTimes(baseline + 2),
    );

    // A different admitted task (cached A reselected) invalidates again.
    vi.mocked(getSectionAnalysisStatus).mockResolvedValue({
      ...sectionStatus,
      task: {
        ...sectionTask,
        id: "44444444-4444-4444-8444-444444444445",
      },
    });
    await view.result.current.refetch();
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledTimes(baseline + 4),
    );
    view.unmount();
    client.clear();
  });
});

describe("section-analysis start admission", () => {
  it("posts the request and refreshes selected task, protocol and findings", async () => {
    vi.mocked(startSectionAnalysis).mockResolvedValue({
      schema_version: 1,
      request_id: sectionRequestId,
      task: sectionTask,
    });
    const client = new QueryClient();
    const sectionKey = ["objects", sectionObjectId, "section-analysis"];
    const protocolKey = ["objects", sectionObjectId, "protocol"];
    const findingsKey = ["objects", sectionObjectId, "findings"];
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => useStartSectionAnalysis(sectionObjectId),
      { wrapper },
    );
    await act(async () => {
      await result.current.mutateAsync({
        request_id: sectionRequestId,
        expected_run_id: sectionRunId,
      });
    });
    expect(startSectionAnalysis).toHaveBeenCalledWith(sectionObjectId, {
      request_id: sectionRequestId,
      expected_run_id: sectionRunId,
    });
    const keys = invalidateSpy.mock.calls.map(([filters]) => filters?.queryKey);
    expect(keys).toContainEqual(sectionKey);
    expect(keys).toContainEqual(protocolKey);
    expect(keys).toContainEqual(findingsKey);
    client.clear();
  });
});
