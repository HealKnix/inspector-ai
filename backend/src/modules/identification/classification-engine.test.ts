import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ParseArtifactData,
  ParseBlock,
  ParsePage,
} from "../parsing/parsing-contract.js";
import { readClassificationConfig } from "./classification-config.js";
import {
  buildClassificationContext,
  MAX_CONTEXT_CHARACTERS,
  MAX_CONTEXT_FRAGMENTS,
} from "./classification-context.js";
import {
  classificationFingerprint,
  classify,
} from "./classification-engine.js";

// Synthetic fixtures only; no customer documents are sent to a provider.
function block(
  id: string,
  text: string,
  extra: Partial<ParseBlock> = {},
): ParseBlock {
  return {
    id,
    order: Number(id.replace(/\D/g, "")) || 0,
    kind: "text",
    raw_text: text,
    normalized_text: text,
    bbox: [0.1, 0.1, 0.9, 0.2],
    confidence: null,
    source: "native",
    structural_path: null,
    table_id: null,
    row: null,
    column: null,
    row_span: null,
    column_span: null,
    ...extra,
  };
}
function artifact(...pages: ParseBlock[][]): ParseArtifactData {
  return {
    schema_version: 1,
    source_sha256: "a".repeat(64),
    pipeline_fingerprint: "b".repeat(64),
    versions: { parser: "synthetic" },
    raw_text: "FULL DOCUMENT MUST NOT BE SENT",
    normalized_text: "FULL DOCUMENT MUST NOT BE SENT",
    quality: "OK",
    reasons: [],
    coverage: {
      total_pages: pages.length,
      readable_pages: pages.length,
      unreadable_pages: 0,
    },
    pages: pages.map((blocks, index): ParsePage => ({
      page_number: index + 1,
      sheet_label: null,
      width: 100,
      height: 100,
      image_key: `synthetic-${index}`,
      image_sha256: "c".repeat(64),
      quality: "OK",
      reasons: [],
      transform: {},
      blocks,
    })),
  };
}
const disabled = readClassificationConfig({});
const local = readClassificationConfig({
  CLASSIFICATION_LLM_ENABLED: "true",
  CLASSIFICATION_LLM_BASE_URL: "http://localhost:11434/v1",
  CLASSIFICATION_LLM_MODEL: "synthetic-qwen",
  CLASSIFICATION_LLM_RESPONSE_FORMAT: "json_object",
});
function output(content: unknown, finish_reason = "stop") {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason,
          message: {
            content:
              typeof content === "string" ? content : JSON.stringify(content),
          },
        },
      ],
    }),
    { status: 200 },
  );
}
function requestBody(request?: RequestInit) {
  if (typeof request?.body !== "string")
    throw new Error("Expected JSON request body");
  return request.body;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("document classification rules", () => {
  it.each([
    ["Проектная документация", "PD"],
    ["РАБОЧАЯ ДОКУМЕНТАЦИЯ", "RD"],
    ["Исполнительная схема № 12", "ID"],
  ])("uses own title %s", async (text, stage) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await classify(artifact([block("b1", text)]), "pdf", local);
    expect(result).toMatchObject({
      stage,
      method: "rules",
      needs_review: false,
    });
    expect(result.evidence[0]).toMatchObject({ block_id: "b1", quote: text });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not confuse an AOSR with its repeated references to stage R", async () => {
    const result = await classify(
      artifact([
        block("b1", "АКТ"),
        block("b2", "освидетельствования скрытых работ"),
        block("b3", "Работы выполнены по проектной документации:"),
        block("b4", "Стадия Р: 23.009-Р-ГИ"),
        block("b5", "Работы выполнены в соответствии с:"),
        block("b6", "Стадия Р: 23.009-Р-ГИ"),
      ]),
      "docx",
      disabled,
    );
    expect(result).toMatchObject({
      stage: "ID",
      document_kind: "Акт освидетельствования скрытых работ",
    });
    expect(result.candidates).toHaveLength(1);
  });
  it("joins neighboring title fragments and preserves both source locators", async () => {
    const result = await classify(
      artifact([block("b1", "ПРОЕКТНАЯ"), block("b2", "ДОКУМЕНТАЦИЯ")]),
      "pdf",
      disabled,
    );
    expect(result.stage).toBe("PD");
    expect(result.evidence.map((item) => item.block_id)).toEqual(["b1", "b2"]);
  });
  it("keeps an executive drawing ID when its base drawing still has a stage R stamp", async () => {
    const result = await classify(
      artifact([
        block("b1", "Исполнительная схема устройства фундаментной плиты"),
        block("b2", "Стадия", { bbox: [0.7, 0.8, 0.8, 0.84] }),
        block("b3", "Р", { bbox: [0.73, 0.85, 0.77, 0.89] }),
      ]),
      "pdf",
      disabled,
    );
    expect(result).toMatchObject({
      stage: "ID",
      document_kind: "Исполнительная схема",
    });
    expect(result.candidates).toHaveLength(1);
  });
  it("recognizes exact XML own paths and excludes nested references/foreign namespaces", async () => {
    const own =
      "/{http://idActs/AOSR.xsd}aosr[1]/{http://idActs/AOSR.xsd}actInfo[1]/{http://types/CommonTypes.xsd}documentInfo[1]/{http://types/CommonTypes.xsd}name[1]/text()[1]";
    const result = await classify(
      artifact([
        block("b1", "Акт освидетельствования скрытых работ", {
          structural_path: own,
          source: "structured",
        }),
        block("b2", "23.009-Р-ГИ", {
          structural_path: "/references/workDocumentationSectionCode/text()[1]",
        }),
      ]),
      "XML",
      disabled,
    );
    expect(result.stage).toBe("ID");
    expect(result.evidence[0]?.structural_path).toBe(own);
    for (const bad of [
      "/wrapper[1]" + own,
      own.replace(
        "http://idActs/AOSR.xsd",
        "http://untrusted.example/AOSR.xsd",
      ),
    ])
      expect(
        (
          await classify(
            artifact([
              block("b1", "Акт освидетельствования скрытых работ", {
                structural_path: bad,
              }),
            ]),
            "xml",
            disabled,
          )
        ).stage,
      ).toBeNull();
  });
  it("recognizes own XML IS type while ignoring the working drawing reference", async () => {
    const prefix =
      "/{http://idCommon/AsBuiltSchemaDoc.xsd}asBuiltSchemaDoc[1]/{http://idCommon/AsBuiltSchemaDoc.xsd}asBuiltSchemaDocInfo[1]";
    const result = await classify(
      artifact([
        block("b1", "ИС", {
          structural_path:
            prefix +
            "/{http://idCommon/AsBuiltSchemaDoc.xsd}docType[1]/text()[1]",
        }),
        block("b2", "23.009-Р-2-КЖ0.2"),
      ]),
      "xml",
      disabled,
    );
    expect(result).toMatchObject({
      stage: "ID",
      document_kind: "Исполнительная схема",
    });
  });
  it("pairs the stamp stage label and its geometric value", async () => {
    const result = await classify(
      artifact([
        block("b1", "Стадия", { bbox: [0.7, 0.8, 0.8, 0.84] }),
        block("b2", "Р", { bbox: [0.73, 0.85, 0.77, 0.89] }),
      ]),
      "pdf",
      disabled,
    );
    expect(result).toMatchObject({ stage: "RD", reasons: ["own_stage_cell"] });
    expect(result.evidence.map((item) => item.block_id)).toEqual(["b2", "b1"]);
  });
  it("rejects an unanchored code or a stage phrase in prose", async () => {
    const result = await classify(
      artifact([
        block("b1", "В работе используется проектная документация"),
        block("b2", "23.009-Р-КЖ"),
        block("b3", "Стадия Р"),
      ]),
      "pdf",
      disabled,
    );
    expect(result).toMatchObject({
      stage: null,
      method: "none",
      needs_review: true,
    });
  });
  it("preserves conflicting titles across pages and does not ask the provider to arbitrate", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await classify(
      artifact(
        [block("b1", "Проектная документация")],
        [block("b2", "Рабочая документация")],
      ),
      "pdf",
      local,
    );
    expect(result).toMatchObject({
      stage: null,
      method: "rules",
      needs_review: true,
    });
    expect(result.reasons).toContain("possible_mixed_document");
    expect(result.candidates.map((item) => item.stage)).toEqual(["PD", "RD"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("marks partial parses for review and ignores blocks excluded by the parser", async () => {
    const input = artifact([
      block("b1", "Рабочая документация"),
      block("b2", "Проектная документация", { include_in_main: false }),
    ]);
    input.quality = "LOW_QUALITY";
    expect(await classify(input, "pdf", disabled)).toMatchObject({
      stage: "RD",
      needs_review: true,
    });
  });
  it("does not interpret a numbered attachment as its own title", async () => {
    const result = await classify(
      artifact([
        block("b1", "Приложения:"),
        block("b2", "Исполнительная схема № 12"),
      ]),
      "docx",
      disabled,
    );
    expect(result.stage).toBeNull();
  });
});

describe("bounded provider fallback", () => {
  it("sends selected fragments only and verifies a verbatim citation", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      output({
        stage: "RD",
        document_kind: null,
        evidence: [{ block_id: "b1", quote: "РАБ0ЧАЯ" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await classify(
      artifact([block("b1", "РАБ0ЧАЯ ДОКУМЕНТАЦИЯ")]),
      "pdf",
      local,
    );
    expect(result).toMatchObject({
      stage: "RD",
      method: "llm",
      needs_review: true,
    });
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
    expect(request?.redirect).toBe("error");
    expect(requestBody(request)).not.toContain(
      "FULL DOCUMENT MUST NOT BE SENT",
    );
    expect(JSON.parse(requestBody(request))).toMatchObject({
      model: "synthetic-qwen",
      response_format: { type: "json_object" },
    });
  });
  it("uses the configured remote endpoint/schema without automatic fallback", async () => {
    const config = readClassificationConfig({
      CLASSIFICATION_LLM_ENABLED: "true",
      CLASSIFICATION_LLM_API_KEY: "test-only-key",
    });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        output({ stage: null, document_kind: null, evidence: [] }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await classify(artifact([block("b1", "Неясный заголовок")]), "pdf", config);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(JSON.parse(requestBody(request))).toMatchObject({
      response_format: { type: "json_schema", json_schema: { strict: true } },
    });
  });
  it.each([
    ["not json", "classification_llm_invalid_result"],
    [
      {
        stage: "RD",
        document_kind: null,
        confidence: 0.99,
        evidence: [{ block_id: "b1", quote: "test" }],
      },
      "classification_llm_invalid_result",
    ],
    [
      { stage: "RD", document_kind: null, evidence: [] },
      "classification_llm_invalid_result",
    ],
    [
      {
        stage: "RD",
        document_kind: null,
        evidence: [{ block_id: "other", quote: "test" }],
      },
      "classification_llm_citation_mismatch",
    ],
    [
      {
        stage: "RD",
        document_kind: null,
        evidence: [{ block_id: "b1", quote: "invented" }],
      },
      "classification_llm_citation_mismatch",
    ],
  ])("rejects malformed or unsupported evidence %#", async (content, code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(output(content)),
    );
    await expect(
      classify(artifact([block("b1", "test")]), "pdf", local),
    ).rejects.toMatchObject({ code, retryable: false });
  });
  it.each([
    [429, true],
    [503, true],
    [401, false],
    [302, false],
  ])("handles HTTP %s explicitly", async (status, retryable) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("secret provider body", { status }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      classify(artifact([block("b1", "test")]), "pdf", local),
    ).rejects.toMatchObject({
      message: `classification_llm_http_${status}`,
      retryable,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("enforces response size and unfinished generation", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("x".repeat(2000)));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      classify(artifact([block("b1", "test")]), "pdf", {
        ...local,
        maxResponseBytes: 1024,
      }),
    ).rejects.toMatchObject({ code: "classification_llm_response_too_large" });
    fetchMock.mockResolvedValue(
      output({ stage: null, document_kind: null, evidence: [] }, "length"),
    );
    await expect(
      classify(artifact([block("b1", "test")]), "pdf", local),
    ).rejects.toMatchObject({ code: "classification_llm_invalid_result" });
  });
  it("returns a safe timeout without leaking provider errors", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener("abort", () =>
              reject(new Error("secret url and token")),
            );
          }),
      ),
    );
    const promise = classify(artifact([block("b1", "test")]), "pdf", {
      ...local,
      timeoutMs: 100,
    });
    const assertion = expect(promise).rejects.toMatchObject({
      message: "classification_llm_timeout",
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });
  it("never calls a provider when disabled or text is absent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(
      (await classify(artifact([block("b1", "test")]), "pdf", disabled))
        .reasons,
    ).toContain("llm_disabled");
    expect((await classify(artifact([]), "pdf", local)).reasons).toContain(
      "no_classification_fragments",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("classification configuration and context", () => {
  it("keeps an anchor in a long block instead of sending only its unrelated prefix", () => {
    const context = buildClassificationContext(
      artifact([
        block(
          "b1",
          "x".repeat(2000) + " Рабочая документация " + "y".repeat(2000),
        ),
      ]),
    );
    expect(context.fragments[0]?.text).toContain("Рабочая документация");
    expect(context.fragments[0]?.text.length).toBeLessThanOrEqual(900);
    expect(context.truncated).toBe(true);
  });
  it("bounds context while considering anchors from later pages", () => {
    const input = artifact(
      ...Array.from({ length: 80 }, (_, page) => [
        block(`b${page}`, "Стaдия документа " + "x".repeat(3000)),
      ]),
    );
    input.pages[79]!.blocks[0] = block("last", "Исполнительная документация");
    const context = buildClassificationContext(input);
    expect(context.fragments.some((item) => item.block_id === "last")).toBe(
      true,
    );
    expect(context.fragments.length).toBeLessThanOrEqual(MAX_CONTEXT_FRAGMENTS);
    expect(
      context.fragments.reduce(
        (sum, item) => sum + JSON.stringify(item).length,
        0,
      ),
    ).toBeLessThanOrEqual(MAX_CONTEXT_CHARACTERS);
    expect(context.truncated).toBe(true);
  });
  it("rejects invalid configuration and accepts ConfigService-style getters", () => {
    expect(readClassificationConfig({ get: () => undefined }).enabled).toBe(
      false,
    );
    for (const env of [
      { CLASSIFICATION_LLM_ENABLED: "yes" },
      { CLASSIFICATION_LLM_ENABLED: true },
      { CLASSIFICATION_LLM_BASE_URL: "file:///etc/passwd" },
      { CLASSIFICATION_LLM_BASE_URL: "https://user:password@example.com" },
      { CLASSIFICATION_LLM_RESPONSE_FORMAT: "text" },
      { CLASSIFICATION_LLM_TIMEOUT_MS: "0" },
    ])
      expect(() => readClassificationConfig(env)).toThrow();
    expect(classificationFingerprint(local)).toBe(
      classificationFingerprint({ ...local, apiKey: "rotated" }),
    );
    expect(classificationFingerprint(local)).not.toBe(
      classificationFingerprint({ ...local, model: "changed" }),
    );
  });
});
