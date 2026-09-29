import {
  sectionObjectId,
  sectionRequestId,
  sectionRunId,
  sectionStatus,
  sectionTask,
} from "../types/section-analysis-test-fixtures";
import {
  getSectionAnalysisStatus,
  startSectionAnalysis,
} from "./section-analysis";

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/api/client", () => ({ apiClient: { get, post } }));

beforeEach(() => {
  get.mockReset();
  post.mockReset();
});

describe("section-analysis endpoints", () => {
  it("requests the latest state without a run filter", async () => {
    get.mockResolvedValue({ data: sectionStatus });
    const status = await getSectionAnalysisStatus(sectionObjectId);
    expect(status.run_id).toBe(sectionRunId);
    expect(get).toHaveBeenCalledWith(
      `/v1/objects/${sectionObjectId}/section-analysis`,
      { signal: undefined },
    );
  });

  it("pins an explicit run when runId is provided", async () => {
    get.mockResolvedValue({ data: sectionStatus });
    await getSectionAnalysisStatus(sectionObjectId, sectionRunId);
    expect(get).toHaveBeenCalledWith(
      `/v1/objects/${sectionObjectId}/section-analysis`,
      { signal: undefined, params: { run_id: sectionRunId } },
    );
  });

  it("posts an idempotent start admission", async () => {
    post.mockResolvedValue({
      data: {
        schema_version: 1,
        request_id: sectionRequestId,
        task: sectionTask,
      },
    });
    const response = await startSectionAnalysis(sectionObjectId, {
      request_id: sectionRequestId,
      expected_run_id: sectionRunId,
      parameter_codes: ["P001"],
    });
    expect(response.task.id).toBe(sectionTask.id);
    expect(post).toHaveBeenCalledWith(
      `/v1/objects/${sectionObjectId}/section-analysis`,
      {
        request_id: sectionRequestId,
        expected_run_id: sectionRunId,
        parameter_codes: ["P001"],
      },
    );
  });

  it("rejects a malformed status payload instead of trusting it", async () => {
    get.mockResolvedValue({
      data: { ...sectionStatus, task: { ...sectionTask, state: "crashed" } },
    });
    await expect(getSectionAnalysisStatus(sectionObjectId)).rejects.toThrow();
  });
});
