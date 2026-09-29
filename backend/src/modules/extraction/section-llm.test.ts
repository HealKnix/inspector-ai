import { describe, expect, it } from "vitest";
import type { SectionAnalysisConfig } from "./section-config.js";
import { SectionAnalysisError } from "./section-contract.js";
import { callSectionLlm } from "./section-llm.js";

// Synthetic fixtures only; no real documents or provider calls are used.

function config(
  over: Partial<SectionAnalysisConfig> = {},
): SectionAnalysisConfig {
  return {
    enabled: true,
    baseUrl: "https://openrouter.ai/api/v1",
    model: "qwen/qwen3.8-27b",
    apiKey: "sk-synthetic",
    requireParameters: true,
    timeoutMs: 30_000,
    maxRequestBytes: 262_144,
    maxResponseBytes: 131_072,
    maxCandidateBytes: 49_152,
    maxChunkBytes: 98_304,
    maxBlockCharacters: 4000,
    maxParametersPerRequest: 8,
    maxCalls: 32,
    maxExpansionCandidates: 8,
    ...over,
  };
}

function okResponse(content: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          message: { role: "assistant", content: JSON.stringify(content) },
        },
      ],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function code(error: unknown): string {
  return error instanceof SectionAnalysisError ? error.code : String(error);
}

describe("callSectionLlm", () => {
  it("throws section_llm_disabled when the feature flag is off", async () => {
    await expect(
      callSectionLlm(config({ enabled: false }), "discovery", {}),
    ).rejects.toThrowError(/section_llm_disabled/);
  });

  it("posts a strict json_schema request without optional model controls", async () => {
    let seen: {
      url: string;
      body: Record<string, unknown>;
      headers: Headers;
    } | null = null;
    const fetchImpl: typeof fetch = (url, init) => {
      seen = {
        url:
          typeof url === "string"
            ? url
            : url instanceof URL
              ? url.href
              : url.url,
        body: JSON.parse(
          typeof init?.body === "string" ? init.body : "",
        ) as Record<string, unknown>,
        headers: new Headers(init?.headers),
      };
      return Promise.resolve(
        okResponse({ sections: [], expand: [], missing_context: [] }),
      );
    };
    await callSectionLlm(config(), "discovery", { probe: 1 }, { fetchImpl });
    expect(seen!.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = seen!.body;
    expect(body.model).toBe("qwen/qwen3.8-27b");
    // No optional controls that could narrow strict provider routing.
    expect("reasoning" in body).toBe(false);
    expect("temperature" in body).toBe(false);
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "section_discovery",
        strict: true,
        schema: expect.any(Object) as Record<string, unknown>,
      },
    });
    expect(body.provider).toEqual({ require_parameters: true });
    expect(seen!.headers.get("authorization")).toBe("Bearer sk-synthetic");
    const messages = body.messages as { role: string; content: string }[];
    expect(messages[0]!.role).toBe("system");
    expect(messages[1]!.role).toBe("user");
    expect(JSON.parse(messages[1]!.content)).toEqual({ probe: 1 });
  });

  it("omits provider.require_parameters for non-OpenRouter endpoints", async () => {
    let body: Record<string, unknown> | null = null;
    const fetchImpl: typeof fetch = (_url, init) => {
      body = JSON.parse(
        typeof init?.body === "string" ? init.body : "",
      ) as Record<string, unknown>;
      return Promise.resolve(okResponse({ results: [] }));
    };
    await callSectionLlm(
      config({ baseUrl: "https://llm.internal/v1", requireParameters: false }),
      "analysis",
      {},
      { fetchImpl },
    );
    expect("provider" in body!).toBe(false);
  });

  it("returns the parsed message content to the caller for validation", async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(okResponse({ hello: "world" }));
    const out = await callSectionLlm(config(), "analysis", {}, { fetchImpl });
    expect(out).toEqual({ hello: "world" });
  });

  it("rejects non-2xx, redirects are disabled and codes classify retry", async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(new Response("oops", { status: 500 }));
    await expect(
      callSectionLlm(config(), "discovery", {}, { fetchImpl }),
    ).rejects.toMatchObject({
      name: "SectionAnalysisError",
      code: "section_llm_http_500",
      retryable: true,
    });
    const bad: typeof fetch = () =>
      Promise.resolve(new Response("nope", { status: 400 }));
    await expect(
      callSectionLlm(config(), "discovery", {}, { fetchImpl: bad }),
    ).rejects.toMatchObject({ code: "section_llm_http_400", retryable: false });
  });

  it("rejects tool calls, refusals and incomplete finishes", async () => {
    const envelope = (message: Record<string, unknown>, finish = "stop") =>
      new Response(
        JSON.stringify({ choices: [{ finish_reason: finish, message }] }),
      );
    for (const response of [
      envelope({ content: "{}", tool_calls: [{}] }),
      envelope({ content: "{}", refusal: "cannot" }),
      envelope({ content: "{}" }, "length"),
      envelope({ content: "not json" }),
    ]) {
      const fetchImpl: typeof fetch = () => Promise.resolve(response);
      expect(
        code(
          await callSectionLlm(config(), "analysis", {}, { fetchImpl }).catch(
            (error: unknown) => error,
          ),
        ),
      ).toBe("section_llm_invalid_result");
    }
  });

  it("rejects malformed envelopes and oversized responses", async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(new Response(JSON.stringify({ choices: [] })));
    await expect(
      callSectionLlm(config(), "analysis", {}, { fetchImpl }),
    ).rejects.toThrowError(/section_llm_invalid_result/);

    const declared: typeof fetch = () =>
      Promise.resolve(
        new Response("x", {
          headers: { "content-length": "999999999" },
        }),
      );
    await expect(
      callSectionLlm(
        config({ maxResponseBytes: 1024 }),
        "analysis",
        {},
        { fetchImpl: declared },
      ),
    ).rejects.toThrowError(/section_llm_response_too_large/);

    const streamed: typeof fetch = () =>
      Promise.resolve(new Response(new Blob(["x".repeat(4096)])));
    await expect(
      callSectionLlm(
        config({ maxResponseBytes: 1024 }),
        "analysis",
        {},
        { fetchImpl: streamed },
      ),
    ).rejects.toThrowError(/section_llm_response_too_large/);
  });

  it("reassembles a streamed response into the validated envelope", async () => {
    const frame = (data: string) => `data: ${data}\n\n`;
    const sse = [
      frame(JSON.stringify({ choices: [{ delta: { role: "assistant" } }] })),
      frame(JSON.stringify({ choices: [{ delta: { content: '{"res' } }] })),
      frame(JSON.stringify({ choices: [{ delta: { content: 'ults":[]}' } }] })),
      frame(
        JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] }),
      ),
      frame("[DONE]"),
    ].join("");
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(
        new Response(sse, {
          headers: { "content-type": "text/event-stream" },
        }),
      );
    const out = await callSectionLlm(config(), "analysis", {}, { fetchImpl });
    expect(out).toEqual({ results: [] });
  });

  it("rejects streams ending without the done sentinel or a stop finish", async () => {
    const noDone: typeof fetch = () =>
      Promise.resolve(
        new Response('data: {"choices":[{"delta":{"content":"{}"}}]}\n\n', {
          headers: { "content-type": "text/event-stream" },
        }),
      );
    await expect(
      callSectionLlm(config(), "analysis", {}, { fetchImpl: noDone }),
    ).rejects.toThrowError(/section_llm_invalid_result/);

    const truncated: typeof fetch = () =>
      Promise.resolve(
        new Response(
          'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',
          { headers: { "content-type": "text/event-stream" } },
        ),
      );
    await expect(
      callSectionLlm(config(), "analysis", {}, { fetchImpl: truncated }),
    ).rejects.toThrowError(/section_llm_invalid_result/);
  });

  it("bounds the serialized request before any fetch happens", async () => {
    let called = false;
    const fetchImpl: typeof fetch = () => {
      called = true;
      return Promise.resolve(okResponse({}));
    };
    await expect(
      callSectionLlm(
        config({ maxRequestBytes: 4096 }),
        "analysis",
        { blob: "x".repeat(16_000) },
        { fetchImpl },
      ),
    ).rejects.toThrowError(/section_llm_request_too_large/);
    expect(called).toBe(false);
  });

  it("aborts on the configured timeout as a retryable error", async () => {
    const fetchImpl: typeof fetch = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    await expect(
      callSectionLlm(config({ timeoutMs: 20 }), "analysis", {}, { fetchImpl }),
    ).rejects.toMatchObject({
      code: "section_llm_timeout",
      retryable: true,
    });
  });
});
