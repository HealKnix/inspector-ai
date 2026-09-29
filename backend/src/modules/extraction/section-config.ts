import {
  readClassificationConfig,
  type ClassificationConfig,
} from "../identification/classification-config.js";

/**
 * Section-analysis provider configuration. It has its own explicit enable flag
 * — SECTION_LLM_ENABLED, off by default — so a configured classification model
 * alone never sends section text anywhere. Endpoint properties reuse the
 * established CLASSIFICATION_LLM_* provider configuration; each one can be
 * overridden by the documented SECTION_LLM_* variable.
 */
export interface SectionAnalysisConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  apiKey: string;
  /** provider.require_parameters=true on OpenRouter strict json_schema calls. */
  requireParameters: boolean;
  timeoutMs: number;
  maxRequestBytes: number;
  maxResponseBytes: number;
  /** Discovery candidate manifest budget per source context. */
  maxCandidateBytes: number;
  /** One serialized chunk must leave room for its pair and parameters. */
  maxChunkBytes: number;
  /** Blocks larger than this are omitted and reported as missing coverage. */
  maxBlockCharacters: number;
  maxParametersPerRequest: number;
  /** Total provider calls (discovery + analysis) per engine invocation. */
  maxCalls: number;
  /** Bounded second discovery pass: anchors that may be expanded once. */
  maxExpansionCandidates: number;
}

type ConfigSource = Record<string, unknown> | { get(key: string): unknown };
function hasGetter(
  source: ConfigSource,
): source is { get(key: string): unknown } {
  return typeof source.get === "function";
}

export function readSectionAnalysisConfig(
  source: ConfigSource,
  classification: ClassificationConfig = readClassificationConfig(source),
): SectionAnalysisConfig {
  // An empty SECTION_LLM_* value means "inherit the classification setting",
  // matching the documented override semantics in .env.example.
  const get = (key: string): unknown => {
    const name = `SECTION_LLM_${key}`;
    const value = hasGetter(source) ? source.get(name) : source[name];
    return typeof value === "string" && value.trim() === "" ? undefined : value;
  };
  const string = (key: string, fallback: string, max: number) => {
    const value = get(key) ?? fallback;
    if (
      typeof value !== "string" ||
      value.length > max ||
      /[\r\n\0]/.test(value)
    )
      throw new Error(`Invalid SECTION_LLM_${key}`);
    return value.trim();
  };
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const raw = get(key) ?? fallback;
    const value =
      typeof raw === "number"
        ? raw
        : typeof raw === "string" && /^\d+$/.test(raw)
          ? Number(raw)
          : NaN;
    if (!Number.isSafeInteger(value) || value < min || value > max)
      throw new Error(`Invalid SECTION_LLM_${key}`);
    return value;
  };
  const enabledValue = get("ENABLED") ?? false;
  if (
    ![true, false, "true", "false"].includes(enabledValue as boolean | string)
  )
    throw new Error("Invalid SECTION_LLM_ENABLED");
  const enabled = enabledValue === true || enabledValue === "true";
  const baseUrl = string("BASE_URL", classification.baseUrl, 2048).replace(
    /\/+$/,
    "",
  );
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("Invalid SECTION_LLM_BASE_URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid SECTION_LLM_BASE_URL");
  const model = string("MODEL", classification.model, 256);
  const apiKey = string("API_KEY", classification.apiKey, 4096);
  if (enabled && (!model || (url.hostname === "openrouter.ai" && !apiKey)))
    throw new Error("SECTION_LLM_MODEL and provider API key are required");
  const maxRequestBytes = integer(
    "MAX_REQUEST_BYTES",
    262_144,
    4096,
    4_194_304,
  );
  const maxChunkBytes = integer("MAX_CHUNK_BYTES", 98_304, 1024, 1_048_576);
  // A request always carries chunks of both roles plus row descriptors, so a
  // chunk cap beyond half the request budget would make every unit oversized.
  if (maxChunkBytes * 2 > maxRequestBytes)
    throw new Error(
      "SECTION_LLM_MAX_CHUNK_BYTES must not exceed half of SECTION_LLM_MAX_REQUEST_BYTES",
    );
  return {
    enabled,
    baseUrl,
    model,
    apiKey,
    requireParameters: url.hostname === "openrouter.ai",
    // CPU-hosted inference on the documented offline profile legitimately
    // exceeds ten minutes for a single strict-schema call; the cap must stay
    // below the worker-side hard runtime bound but allow that profile.
    timeoutMs: integer("TIMEOUT_MS", classification.timeoutMs, 100, 3_600_000),
    maxRequestBytes,
    maxResponseBytes: integer(
      "MAX_RESPONSE_BYTES",
      classification.maxResponseBytes,
      1024,
      1_048_576,
    ),
    maxCandidateBytes: integer("MAX_CANDIDATE_BYTES", 49_152, 1024, 262_144),
    maxChunkBytes,
    maxBlockCharacters: integer("MAX_BLOCK_CHARACTERS", 4000, 256, 32_768),
    maxParametersPerRequest: integer("MAX_PARAMETERS_PER_REQUEST", 8, 1, 32),
    maxCalls: integer("MAX_CALLS", 32, 1, 256),
    maxExpansionCandidates: integer("MAX_EXPANSION_CANDIDATES", 8, 0, 32),
  };
}
