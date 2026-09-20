import {
  classificationResult,
  classificationStatus,
  classifiedFile,
} from "@/api/types/classification-test-fixtures";
import { parsingObjectId } from "@/api/types/parsing-test-fixtures";
import { getClassificationStatus, retryClassification } from "./classification";

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/api/client", () => ({ apiClient: { get, post } }));
beforeEach(() => vi.resetAllMocks());

describe("classification boundary", () => {
  it("передаёт сигнал отмены и сохраняет неизвестную принадлежность", async () => {
    const signal = new AbortController().signal;
    const response = {
      ...classificationStatus,
      items: [
        {
          ...classifiedFile,
          result: { ...classificationResult, stage: null, needs_review: true },
        },
      ],
    };
    get.mockResolvedValue({ data: response });
    expect(await getClassificationStatus(parsingObjectId, signal)).toEqual(
      response,
    );
    expect(get).toHaveBeenCalledWith(
      `/v1/objects/${parsingObjectId}/classification`,
      { signal },
    );
  });
  it.each([
    { ...classificationStatus, schema_version: 2 },
    { ...classificationStatus, items: [{ ...classifiedFile, state: "READY" }] },
    {
      ...classificationStatus,
      items: [
        {
          ...classifiedFile,
          result: { ...classificationResult, stage: "PROJECT" },
        },
      ],
    },
    {
      ...classificationStatus,
      items: [
        {
          ...classifiedFile,
          result: {
            ...classificationResult,
            evidence: [
              { ...classificationResult.evidence[0], bbox: [0, 0, 2, 1] },
            ],
          },
        },
      ],
    },
  ])(
    "отклоняет несовместимые статусы и неверные доказательства",
    async (response) => {
      get.mockResolvedValue({ data: response });
      await expect(getClassificationStatus(parsingObjectId)).rejects.toThrow();
    },
  );
  it("повторяет только классификацию с ключом идемпотентности", async () => {
    const requestId = "88888888-8888-4888-8888-888888888888";
    const result = { request_id: requestId, task_id: classifiedFile.task_id };
    post.mockResolvedValue({ data: result });
    expect(
      await retryClassification({
        objectId: parsingObjectId,
        fileId: classifiedFile.file_id,
        requestId,
      }),
    ).toEqual(result);
    expect(post).toHaveBeenCalledExactlyOnceWith(
      `/v1/objects/${parsingObjectId}/files/${classifiedFile.file_id}/classification/retry`,
      { request_id: requestId },
    );
  });
  it("не принимает подтверждение другого запроса", async () => {
    post.mockResolvedValue({
      data: {
        request_id: classifiedFile.run_id,
        task_id: classifiedFile.task_id,
      },
    });
    await expect(
      retryClassification({
        objectId: parsingObjectId,
        fileId: classifiedFile.file_id,
        requestId: "88888888-8888-4888-8888-888888888888",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
