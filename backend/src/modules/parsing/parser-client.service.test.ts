import { ConfigService } from "@nestjs/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isParserNotAdmitted,
  ParserClientService,
} from "./parser-client.service.js";

const fingerprint = "a".repeat(64);
const fetchMock = vi.fn<typeof fetch>();
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
      )
      .catch((failure: unknown) => failure);
    expect(isParserNotAdmitted(error)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
