import { describe, expect, it } from "vitest";
import { readSectionAnalysisConfig } from "./section-config.js";

// Synthetic environment records only.

describe("readSectionAnalysisConfig", () => {
  it("is disabled by default even when classification is configured", () => {
    const config = readSectionAnalysisConfig({
      CLASSIFICATION_LLM_API_KEY: "sk-x",
    });
    expect(config.enabled).toBe(false);
    // Endpoint identity still inherits the classification provider.
    expect(config.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(config.requireParameters).toBe(true);
  });

  it("enables only on the explicit SECTION_LLM_ENABLED flag", () => {
    const config = readSectionAnalysisConfig({
      SECTION_LLM_ENABLED: "true",
      CLASSIFICATION_LLM_API_KEY: "sk-x",
    });
    expect(config.enabled).toBe(true);
    expect(() =>
      readSectionAnalysisConfig({ SECTION_LLM_ENABLED: "yes" }),
    ).toThrow(/SECTION_LLM_ENABLED/);
  });

  it("treats empty SECTION_LLM_* values as 'inherit classification'", () => {
    const config = readSectionAnalysisConfig({
      SECTION_LLM_ENABLED: "true",
      SECTION_LLM_BASE_URL: "",
      SECTION_LLM_MODEL: "",
      SECTION_LLM_API_KEY: "sk-section",
      CLASSIFICATION_LLM_BASE_URL: "https://llm.internal/v2/",
      CLASSIFICATION_LLM_MODEL: "internal/model",
      CLASSIFICATION_LLM_API_KEY: "sk-class",
      CLASSIFICATION_LLM_TIMEOUT_MS: "45000",
      CLASSIFICATION_LLM_MAX_RESPONSE_BYTES: "65536",
    });
    expect(config.baseUrl).toBe("https://llm.internal/v2");
    expect(config.model).toBe("internal/model");
    expect(config.apiKey).toBe("sk-section");
    expect(config.requireParameters).toBe(false);
    expect(config.timeoutMs).toBe(45000);
    expect(config.maxResponseBytes).toBe(65536);
  });

  it("applies documented overrides over classification values", () => {
    const config = readSectionAnalysisConfig({
      SECTION_LLM_ENABLED: "true",
      SECTION_LLM_BASE_URL: "https://other.example/v1",
      SECTION_LLM_MODEL: "other/model",
      CLASSIFICATION_LLM_BASE_URL: "https://openrouter.ai/api/v1",
      CLASSIFICATION_LLM_MODEL: "qwen/x",
      CLASSIFICATION_LLM_API_KEY: "sk-x",
    });
    expect(config.baseUrl).toBe("https://other.example/v1");
    expect(config.model).toBe("other/model");
    expect(config.requireParameters).toBe(false);
  });

  it("rejects malformed, credentialed and parameterized base URLs", () => {
    for (const baseUrl of [
      "not a url",
      "ftp://host/v1",
      "https://user:pw@host/v1",
      "https://host/v1?x=1",
      "https://host/v1#frag",
    ])
      expect(() =>
        readSectionAnalysisConfig({ SECTION_LLM_BASE_URL: baseUrl }),
      ).toThrow(/SECTION_LLM_BASE_URL/);
  });

  it("requires a model and an OpenRouter key only when enabled", () => {
    expect(() =>
      readSectionAnalysisConfig({
        SECTION_LLM_ENABLED: "true",
        SECTION_LLM_MODEL: "   ",
      }),
    ).toThrow(/SECTION_LLM_MODEL/);
    expect(() =>
      readSectionAnalysisConfig({
        SECTION_LLM_ENABLED: "true",
        SECTION_LLM_BASE_URL: "https://openrouter.ai/api/v1",
      }),
    ).toThrow(/API key/);
    // Disabled: empty everything is fine.
    expect(
      readSectionAnalysisConfig({ SECTION_LLM_ENABLED: "false" }).enabled,
    ).toBe(false);
  });

  it("keeps a chunk strictly below half of the request budget", () => {
    expect(() =>
      readSectionAnalysisConfig({
        SECTION_LLM_MAX_REQUEST_BYTES: "4096",
        SECTION_LLM_MAX_CHUNK_BYTES: "4096",
      }),
    ).toThrow(/SECTION_LLM_MAX_CHUNK_BYTES/);
  });

  it("validates integer bounds", () => {
    expect(() =>
      readSectionAnalysisConfig({ SECTION_LLM_MAX_CALLS: "0" }),
    ).toThrow(/SECTION_LLM_MAX_CALLS/);
    expect(() =>
      readSectionAnalysisConfig({ SECTION_LLM_TIMEOUT_MS: "10" }),
    ).toThrow(/SECTION_LLM_TIMEOUT_MS/);
    expect(() =>
      readSectionAnalysisConfig({
        SECTION_LLM_MAX_PARAMETERS_PER_REQUEST: "abc",
      }),
    ).toThrow(/SECTION_LLM_MAX_PARAMETERS_PER_REQUEST/);
  });
});
