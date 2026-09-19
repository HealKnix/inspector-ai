export interface ClassificationConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  apiKey: string;
  responseFormat: "json_schema" | "json_object";
  timeoutMs: number;
  maxResponseBytes: number;
}

type ConfigSource = Record<string, unknown> | { get(key: string): unknown };
function hasGetter(
  source: ConfigSource,
): source is { get(key: string): unknown } {
  return typeof source.get === "function";
}

export function readClassificationConfig(
  source: ConfigSource,
): ClassificationConfig {
  const get = (key: string): unknown => {
    const name = `CLASSIFICATION_LLM_${key}`;
    return hasGetter(source) ? source.get(name) : source[name];
  };
  const string = (key: string, fallback: string, max: number) => {
    const value = get(key) ?? fallback;
    if (
      typeof value !== "string" ||
      value.length > max ||
      /[\r\n\0]/.test(value)
    )
      throw new Error(`Invalid CLASSIFICATION_LLM_${key}`);
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
      throw new Error(`Invalid CLASSIFICATION_LLM_${key}`);
    return value;
  };
  const enabledValue = get("ENABLED") ?? false;
  if (
    ![true, false, "true", "false"].includes(enabledValue as boolean | string)
  )
    throw new Error("Invalid CLASSIFICATION_LLM_ENABLED");
  const enabled = enabledValue === true || enabledValue === "true";
  const baseUrl = string(
    "BASE_URL",
    "https://openrouter.ai/api/v1",
    2048,
  ).replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("Invalid CLASSIFICATION_LLM_BASE_URL");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid CLASSIFICATION_LLM_BASE_URL");
  const model = string("MODEL", "qwen/qwen3.8-27b", 256);
  const apiKey = string("API_KEY", "", 4096);
  if (enabled && (!model || (url.hostname === "openrouter.ai" && !apiKey)))
    throw new Error(
      "CLASSIFICATION_LLM_MODEL and provider API key are required",
    );
  const responseFormat = string("RESPONSE_FORMAT", "json_schema", 32);
  if (responseFormat !== "json_schema" && responseFormat !== "json_object")
    throw new Error("Invalid CLASSIFICATION_LLM_RESPONSE_FORMAT");
  return {
    enabled,
    baseUrl,
    model,
    apiKey,
    responseFormat,
    timeoutMs: integer("TIMEOUT_MS", 60_000, 100, 300_000),
    maxResponseBytes: integer("MAX_RESPONSE_BYTES", 131_072, 1024, 1_048_576),
  };
}
