import { record } from "../parsing/parsing-contract.js";

export const EXTRACTION_ENGINE_VERSION = "extraction-engine-v2";

export type ExtractionStatus =
  "extracted" | "ambiguous" | "no_evidence" | "unreadable" | "unsupported";

export interface EvidenceLocator {
  page_number: number;
  sheet_label: string | null;
  block_id: string | null;
  table_id: string | null;
  table_row: number | null;
  table_column: number | null;
  quote: string;
  bbox: [number, number, number, number] | null;
  structural_path: string | null;
}

export interface ExtractionAlternative {
  value_raw: string;
  value: number | string;
  unit: string | null;
  evidence: EvidenceLocator[];
}

export interface ExtractionOutcome {
  schema_version: 1;
  parameter_code: string;
  rule_version_id: string;
  status: ExtractionStatus;
  value_raw: string | null;
  value: number | string | null;
  unit: string | null;
  alternatives: ExtractionAlternative[] | null;
  reason: string | null;
  evidence: EvidenceLocator[];
}

// --- Extraction plans stored in rule_versions.plan ---

export interface TableSignature {
  any: string[];
  all?: string[];
  caption?: string[];
  min_score?: number;
}

export interface TableLookupPlan {
  kind: "table_lookup";
  signature: TableSignature;
  row: { anchors: string[] };
  value: {
    column?: number | "last_numeric";
    header?: string[];
    type?: "number" | "text" | "enum";
    enum?: string[];
    unit?: string[];
  };
}

export interface RegexPlan {
  kind: "regex";
  anchors: string[];
  pattern: string;
  window_blocks?: number;
  type?: "number" | "text" | "enum";
  enum?: string[];
  unit?: string[];
}

export interface CascadePlan {
  kind: "cascade";
  steps: (TableLookupPlan | RegexPlan)[];
}

export type ExtractionPlan = TableLookupPlan | RegexPlan | CascadePlan;

export class PlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanValidationError";
  }
}

const MAX_ANCHORS = 16;
const MAX_TERM_LENGTH = 160;
const MAX_PATTERN_LENGTH = 400;
const MAX_STEPS = 6;
const MAX_ENUM = 64;

function terms(value: unknown, field: string, optional = false): string[] {
  if (value === undefined && optional) return [];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_ANCHORS ||
    !value.every(
      (item) =>
        typeof item === "string" &&
        item.trim().length > 0 &&
        item.length <= MAX_TERM_LENGTH,
    )
  )
    throw new PlanValidationError(
      `${field}: нужен массив из 1..${MAX_ANCHORS} непустых строк`,
    );
  return (value as string[]).map((item) => item.trim());
}

function optionalTerms(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  // LLM drafts commonly emit "field": [] for absent optional lists;
  // an empty list carries no terms, so it validates as absent.
  if (Array.isArray(value) && value.length === 0) return undefined;
  return terms(value, field);
}

function valueType(value: unknown): "number" | "text" | "enum" | undefined {
  if (value === undefined) return undefined;
  if (value === "number" || value === "text" || value === "enum") return value;
  throw new PlanValidationError("value.type: number | text | enum");
}

function enumValues(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value) && value.length === 0) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_ENUM ||
    !value.every((item) => typeof item === "string" && item.trim().length > 0)
  )
    throw new PlanValidationError("enum: массив из 1..64 непустых строк");
  return (value as string[]).map((item) => item.trim());
}

function signature(value: unknown): TableSignature {
  if (!record(value)) throw new PlanValidationError("signature: объект");
  const allowed = new Set(["any", "all", "caption", "min_score"]);
  if (!Object.keys(value).every((key) => allowed.has(key)))
    throw new PlanValidationError("signature: неизвестное поле");
  const result: TableSignature = { any: terms(value.any, "signature.any") };
  const all = optionalTerms(value.all, "signature.all");
  const caption = optionalTerms(value.caption, "signature.caption");
  if (all) result.all = all;
  if (caption) result.caption = caption;
  if (value.min_score !== undefined) {
    if (
      typeof value.min_score !== "number" ||
      !Number.isSafeInteger(value.min_score) ||
      value.min_score < 1 ||
      value.min_score > 100
    )
      throw new PlanValidationError("signature.min_score: целое 1..100");
    result.min_score = value.min_score;
  }
  return result;
}

function valueSpec(value: unknown): TableLookupPlan["value"] {
  if (value === undefined) return {};
  if (!record(value)) throw new PlanValidationError("value: объект");
  const allowed = new Set(["column", "header", "type", "enum", "unit"]);
  if (!Object.keys(value).every((key) => allowed.has(key)))
    throw new PlanValidationError("value: неизвестное поле");
  const result: TableLookupPlan["value"] = {};
  if (value.column !== undefined) {
    if (
      value.column !== "last_numeric" &&
      !(
        typeof value.column === "number" &&
        Number.isSafeInteger(value.column) &&
        value.column >= 0 &&
        value.column < 256
      )
    )
      throw new PlanValidationError(
        "value.column: целое 0..255 или last_numeric",
      );
    result.column = value.column;
  }
  const header = optionalTerms(value.header, "value.header");
  if (header) result.header = header;
  const type = valueType(value.type);
  if (type) result.type = type;
  const list = enumValues(value.enum);
  if (list) result.enum = list;
  const unit = optionalTerms(value.unit, "value.unit");
  if (unit) result.unit = unit;
  if (result.type === "enum" && !result.enum)
    throw new PlanValidationError("value.type enum требует value.enum");
  return result;
}

function tableLookup(value: Record<string, unknown>): TableLookupPlan {
  const allowed = new Set(["kind", "signature", "row", "value"]);
  if (!Object.keys(value).every((key) => allowed.has(key)))
    throw new PlanValidationError("table_lookup: неизвестное поле");
  if (!record(value.row)) throw new PlanValidationError("row: объект");
  const anchors = terms(value.row.anchors, "row.anchors");
  const spec = valueSpec(value.value);
  return {
    kind: "table_lookup",
    signature: signature(value.signature),
    row: { anchors },
    value: spec ?? {},
  };
}

function regexPlan(value: Record<string, unknown>): RegexPlan {
  const allowed = new Set([
    "kind",
    "anchors",
    "pattern",
    "window_blocks",
    "type",
    "enum",
    "unit",
  ]);
  if (!Object.keys(value).every((key) => allowed.has(key)))
    throw new PlanValidationError("regex: неизвестное поле");
  if (
    typeof value.pattern !== "string" ||
    !value.pattern.trim() ||
    value.pattern.length > MAX_PATTERN_LENGTH
  )
    throw new PlanValidationError("pattern: непустая строка до 400 символов");
  try {
    new RegExp(value.pattern, "iu");
  } catch {
    throw new PlanValidationError("pattern: некорректное регулярное выражение");
  }
  const result: RegexPlan = {
    kind: "regex",
    anchors: terms(value.anchors, "anchors"),
    pattern: value.pattern,
  };
  if (value.window_blocks !== undefined) {
    if (
      typeof value.window_blocks !== "number" ||
      !Number.isSafeInteger(value.window_blocks) ||
      value.window_blocks < 0 ||
      value.window_blocks > 12
    )
      throw new PlanValidationError("window_blocks: целое 0..12");
    result.window_blocks = value.window_blocks;
  }
  const type = valueType(value.type);
  if (type) result.type = type;
  const list = enumValues(value.enum);
  if (list) result.enum = list;
  const unit = optionalTerms(value.unit, "unit");
  if (unit) result.unit = unit;
  if (result.type === "enum" && !result.enum)
    throw new PlanValidationError("type enum требует enum");
  return result;
}

export function validateExtractionPlan(value: unknown): ExtractionPlan {
  if (!record(value) || typeof value.kind !== "string")
    throw new PlanValidationError("plan: объект с полем kind");
  if (value.kind === "table_lookup") return tableLookup(value);
  if (value.kind === "regex") return regexPlan(value);
  if (value.kind === "cascade") {
    const allowed = new Set(["kind", "steps"]);
    if (!Object.keys(value).every((key) => allowed.has(key)))
      throw new PlanValidationError("cascade: неизвестное поле");
    if (
      !Array.isArray(value.steps) ||
      value.steps.length === 0 ||
      value.steps.length > MAX_STEPS
    )
      throw new PlanValidationError("steps: массив из 1..6 шагов");
    const steps = value.steps.map((step) => {
      const plan = validateExtractionPlan(step);
      if (plan.kind === "cascade")
        throw new PlanValidationError("вложенный cascade не поддерживается");
      return plan;
    });
    return { kind: "cascade", steps };
  }
  throw new PlanValidationError(`неподдерживаемый тип плана: ${value.kind}`);
}
