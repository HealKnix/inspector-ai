import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isParserNotAdmitted,
  ParserClientService,
} from "./parser-client.service.js";

const fingerprint = "a".repeat(64);
const fetchMock = vi.fn<typeof fetch>();
vi.mock("./parser-post.js", () => ({
  postParser: (
    url: string,
    headers: Record<string, string>,
    body: string,
    signal: AbortSignal,
  ) => fetchMock(url, { method: "POST", headers, body, signal }),
}));
const client = new ParserClientService(
  new ConfigService({
    PARSER_URL: "http://parser.test:8090",
    PARSER_TOKEN: "synthetic-internal-token-for-tests",
  }),
);

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("parser readiness admission", () => {
  it("keeps admission when an accepted success response loses its body stream", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.error(new TypeError("synthetic body reset"));
          },
        }),
        { status: 200 },
      ),
    );
    fetchMock.mockResolvedValueOnce(Response.json({ cancelled: false }));
    const error: unknown = await client
      .parse(
        {
          request_id: randomUUID(),
          source_sha256: fingerprint,
          storage_key: randomUUID(),
          format: "pdf",
        },
        new AbortController().signal,
        fingerprint,
      )
      .catch((failure: unknown) => failure);
    expect(error).toMatchObject({
      code: "parser_unavailable",
      retryable: true,
      admitted: true,
    });
  });

  it.each([
    ["cancelled", 200, { cancelled: true }, true],
    ["not cancelled", 200, { cancelled: false }, false],
    ["malformed", 200, { cancelled: "true" }, false],
    ["unauthorized", 401, { cancelled: true }, false],
  ] as const)(
    "checks cancellation admission proof: %s",
    async (_label, status, body, admitted) => {
      const requestId = randomUUID();
      fetchMock.mockRejectedValueOnce(new TypeError("synthetic reset"));
      fetchMock.mockResolvedValueOnce(Response.json(body, { status }));
      const error: unknown = await client
        .parse(
          {
            request_id: requestId,
            source_sha256: fingerprint,
            storage_key: randomUUID(),
            format: "pdf",
          },
          new AbortController().signal,
          fingerprint,
        )
        .catch((failure: unknown) => failure);
      expect(error).toMatchObject({
        code: "parser_unavailable",
        retryable: true,
        admitted,
      });
      expect(fetchMock.mock.calls[1]?.[0]).toBe(
        `http://parser.test:8090/cancel/${requestId}`,
      );
    },
  );

  it("bounds the independent model readiness wait without changing the OCR deadline", () => {
    expect(client.modelsReadyWaitMs).toBe(300_000);
    expect(client.timeoutMs).toBe(610_000);
    for (const value of [0, 29, 1801, 30.5, "invalid"])
      expect(
        () =>
          new ParserClientService(
            new ConfigService({ PARSER_MODEL_READY_WAIT_SECONDS: value }),
          ),
      ).toThrow("Invalid parser configuration");
    expect(
      new ParserClientService(
        new ConfigService({ PARSER_MODEL_READY_WAIT_SECONDS: "30" }),
      ).modelsReadyWaitMs,
    ).toBe(30_000);
  });

  it("reads only progress bound to the pinned pipeline and request UUID", async () => {
    const requestId = randomUUID();
    const value = {
      request_id: requestId,
      pipeline_fingerprint: fingerprint,
      pages_completed: 2,
      pages_total: 20,
      stage: "extracting",
      checkpoint_validated: true,
      checkpoint_pages: 1,
      current_page: 3,
    };
    fetchMock.mockResolvedValueOnce(Response.json(value));
    fetchMock.mockResolvedValueOnce(
      Response.json({ ...value, request_id: randomUUID() }),
    );
    fetchMock.mockResolvedValueOnce(Response.json(value, { status: 404 }));
    await expect(client.progress(requestId, fingerprint)).resolves.toEqual(
      value,
    );
    await expect(client.progress(requestId, fingerprint)).resolves.toBeNull();
    await expect(client.progress(requestId, fingerprint)).resolves.toBeNull();
  });

  it("pins the fingerprint only after an authenticated successful health response", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ status: "ok", pipeline_fingerprint: fingerprint }),
    );
    await expect(client.fingerprint()).resolves.toBe(fingerprint);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://parser.test:8090/health");
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("Authorization"),
    ).toBe("Bearer synthetic-internal-token-for-tests");
  });

  it("treats only explicit 503 models_not_ready as non-admission", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { code: "models_not_ready", retryable: true },
        { status: 503 },
      ),
    );
    const error: unknown = await client
      .fingerprint()
      .catch((failure: unknown) => failure);
    expect(error).toMatchObject({ code: "models_not_ready", retryable: true });
    expect(isParserNotAdmitted(error)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: "other service failure",
      status: 503,
      body: { code: "parser_failure", retryable: true },
    },
    {
      label: "missing retry flag",
      status: 503,
      body: { code: "models_not_ready" },
    },
    {
      label: "wrong retry type",
      status: 503,
      body: { code: "models_not_ready", retryable: "true" },
    },
    {
      label: "permanent error",
      status: 503,
      body: { code: "models_not_ready", retryable: false },
    },
    {
      label: "wrong error case",
      status: 503,
      body: { code: "MODELS_NOT_READY", retryable: true },
    },
    {
      label: "authorization failure",
      status: 401,
      body: { code: "models_not_ready", retryable: true },
    },
    {
      label: "forbidden",
      status: 403,
      body: { code: "models_not_ready", retryable: true },
    },
    {
      label: "wrong service status",
      status: 500,
      body: { code: "models_not_ready", retryable: true },
    },
    {
      label: "malformed success",
      status: 200,
      body: { status: "ok", pipeline_fingerprint: "wrong" },
    },
  ])("keeps bounded failure policy for $label", async ({ status, body }) => {
    fetchMock.mockResolvedValue(Response.json(body, { status }));
    const error: unknown = await client
      .fingerprint()
      .catch((failure: unknown) => failure);
    expect(error).toMatchObject({
      code: "parser_unavailable",
      retryable: true,
    });
    expect(isParserNotAdmitted(error)).toBe(false);
  });

  it("does not grant non-admission to invalid JSON or transport errors", async () => {
    fetchMock.mockResolvedValueOnce(new Response("not JSON", { status: 503 }));
    fetchMock.mockRejectedValueOnce(new TypeError("synthetic network failure"));
    for (let index = 0; index < 2; index++) {
      const error: unknown = await client
        .fingerprint()
        .catch((failure: unknown) => failure);
      expect(error).toMatchObject({
        code: "parser_unavailable",
        retryable: true,
      });
      expect(isParserNotAdmitted(error)).toBe(false);
    }
  });

  it("also handles a readiness race after health without cancelling an unadmitted request", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { code: "models_not_ready", retryable: true },
        { status: 503 },
      ),
    );
    const error: unknown = await client
      .parse(
        {
          request_id: "synthetic-request",
          storage_key: "synthetic-key",
          source_sha256: fingerprint,
          format: "pdf",
        },
        new AbortController().signal,
        fingerprint,
      )
      .catch((failure: unknown) => failure);
    expect(isParserNotAdmitted(error)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["matching", "wrong_request", "wrong_fingerprint", "no_admission"])(
    "checks error admission proof: %s",
    async (proof) => {
      const requestId = randomUUID();
      fetchMock.mockResolvedValueOnce(
        Response.json(
          {
            code: "parser_failure",
            retryable: true,
            admitted: proof !== "no_admission",
            request_id: proof === "wrong_request" ? randomUUID() : requestId,
            pipeline_fingerprint:
              proof === "wrong_fingerprint" ? "b".repeat(64) : fingerprint,
          },
          { status: 503 },
        ),
      );
      fetchMock.mockResolvedValueOnce(Response.json({ cancelled: false }));
      const error: unknown = await client
        .parse(
          {
            request_id: requestId,
            source_sha256: fingerprint,
            storage_key: randomUUID(),
            format: "pdf",
          },
          new AbortController().signal,
          fingerprint,
        )
        .catch((failure: unknown) => failure);
      expect(error).toMatchObject({
        code: "parser_failure",
        retryable: true,
        admitted: proof === "matching",
      });
      expect(isParserNotAdmitted(error)).toBe(false);
    },
  );
});
