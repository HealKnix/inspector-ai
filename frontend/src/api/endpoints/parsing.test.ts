import {
  parseResult,
  parsedFile,
  parsingObjectId,
  parsingStatus,
} from "@/api/types/parsing-test-fixtures";
import {
  getParseResult,
  getParsingStatus,
  getRenderedPage,
  retryParsing,
} from "./parsing";

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/api/client", () => ({ apiClient: { get, post } }));

beforeEach(() => vi.resetAllMocks());

describe("parsing boundary", () => {
  it.each([
    { ...parsingStatus, schema_version: 2 },
    { ...parsingStatus, items: [{ ...parsedFile, state: "READY" }] },
  ])("отклоняет неизвестную схему или состояние", async (payload) => {
    get.mockResolvedValue({ data: payload });
    await expect(getParsingStatus(parsingObjectId)).rejects.toThrow();
  });
  it("не принимает результат предыдущего запуска", async () => {
    get.mockResolvedValue({
      data: { ...parseResult, run_id: "77777777-7777-4777-8777-777777777777" },
    });
    await expect(
      getParseResult(
        parsingObjectId,
        parsedFile.file_id,
        parsedFile.run_id,
        parsedFile.artifact_id!,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("не принимает координаты за пределами страницы", async () => {
    const invalid = structuredClone(parseResult);
    invalid.artifact.pages[0]!.blocks[0]!.bbox = [0, 0, 1.1, 0.5];
    get.mockResolvedValue({ data: invalid });
    await expect(
      getParseResult(
        parsingObjectId,
        parsedFile.file_id,
        parsedFile.run_id,
        parsedFile.artifact_id!,
      ),
    ).rejects.toThrow();
  });
  it("отклоняет размеры, не совпадающие с изображением", async () => {
    const invalid = structuredClone(parseResult);
    invalid.artifact.pages[0]!.width = 1200;
    get.mockResolvedValue({ data: invalid });
    await expect(
      getParseResult(
        parsingObjectId,
        parsedFile.file_id,
        parsedFile.run_id,
        parsedFile.artifact_id!,
      ),
    ).rejects.toThrow();
  });
  it("отклоняет неизвестный отпечаток обработчика", async () => {
    const invalid = structuredClone(parseResult);
    invalid.artifact.pipeline_fingerprint = "unknown-version";
    get.mockResolvedValue({ data: invalid });
    await expect(
      getParseResult(
        parsingObjectId,
        parsedFile.file_id,
        parsedFile.run_id,
        parsedFile.artifact_id!,
      ),
    ).rejects.toThrow();
  });
  it("запрашивает защищённую PNG-страницу именно сохранённого результата", async () => {
    const blob = new Blob(["synthetic"], { type: "image/png" });
    const signal = new AbortController().signal;
    get.mockResolvedValue({ data: blob });
    expect(
      await getRenderedPage(
        parsingObjectId,
        parsedFile.file_id,
        parsedFile.artifact_id!,
        1,
        signal,
      ),
    ).toBe(blob);
    expect(get).toHaveBeenCalledWith(
      expect.stringContaining("/parse/pages/1"),
      expect.objectContaining({
        responseType: "blob",
        signal,
        params: { artifact_id: parsedFile.artifact_id },
      }),
    );
  });
  it("повтор использует существующий файл и переданный ключ идемпотентности", async () => {
    post.mockResolvedValue({ status: 202 });
    await retryParsing({
      objectId: parsingObjectId,
      fileId: parsedFile.file_id,
      requestId: "77777777-7777-4777-8777-777777777777",
    });
    expect(post).toHaveBeenCalledWith(
      `/v1/objects/${parsingObjectId}/files/${parsedFile.file_id}/parse/retry`,
      { request_id: "77777777-7777-4777-8777-777777777777" },
    );
  });
});
