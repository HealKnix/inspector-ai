import type { RevisionReference } from "../identification/identification-contract.js";
import { record } from "../parsing/parsing-contract.js";
import type { EvidenceLocator } from "./extraction-contract.js";

/**
 * Section-first LLM comparison contracts (change add-section-context-analysis,
 * tasks 1.1-1.4 + 2.1). Everything in this file is a pure contract: no NestJS,
 * no Prisma, no fetch. The provider adapter lives in section-llm.ts, the
 * orchestration in section-engine.ts.
 */

export class SectionAnalysisError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "SectionAnalysisError";
  }
}

export const SECTION_ENGINE_VERSION = "section-context-v2";
export const SECTION_DISCOVERY_PROMPT_VERSION = "section-discovery-v2";
export const SECTION_ANALYSIS_PROMPT_VERSION = "section-analysis-v1";

/**
 * Serialized UTF-8 byte length — all configured byte budgets are wire bytes,
 * not UTF-16 code units (Cyrillic text occupies ~2x bytes per character).
 */
export function utf8Bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

/** "reference" is the expected side (ПД/РД basis), "actual" is compared to it. */
export type SectionRole = "reference" | "actual";

export const SECTION_SOURCE_REF = /^(reference|actual):\d{1,3}$/;

/**
 * Real MatrixRow descriptor pinned at admission. Codes and hints come from the
 * matrix import/release, never from the model or the document.
 */
export interface SectionMatrixRow {
  parameter_code: string;
  name: string;
  unit: string | null;
  source_pd: string | null;
  source_rd: string | null;
  source_id: string | null;
  trigger: string;
}

/** Serializable per-source identity for persistence and UI (no text inside). */
export interface SectionSourceInfo {
  /** Wire reference the model sees; role plus ordinal within the context. */
  source_ref: string;
  role: SectionRole;
  /**
   * Physical owning document/revision of this exact artifact view. Inherited
   * sheets keep their predecessor identity; the effective comparison pairing
   * lives on the context result, not here.
   */
  document_id: string;
  revision_id: string;
  /** Server-resolved stage (ПД/РД/ИД) of the owning revision, never model-guessed. */
  document_stage: string | null;
  file_id: string;
  artifact_id: string;
  artifact_sha256: string;
  source_sha256: string;
  /** Resolved-sheet identity; null when the artifact is used in full. */
  selection_hash: string | null;
  /** Physical page numbers present in the (possibly filtered) source stream. */
  pages: number[];
}

/**
 * Compact structural anchor sent to the model. possible_end_block_ids are a
 * representative sample of the legal ends (own block, the next boundary, a
 * stratified set of later boundaries and the last stream block) — validation
 * accepts any real boundary end of the same source via the anchor index, so
 * a true end is never unrepresentable, only unlisted in the manifest.
 */
export interface SectionCandidate {
  candidate_id: string;
  source_ref: string;
  block_id: string;
  page_number: number;
  kind: "heading" | "toc_entry";
  text: string;
  structural_path: string | null;
  possible_end_block_ids: string[];
  neighbors: { before: string | null; after: string | null };
}

/** A validated boundary returned by discovery; ids are server-assigned. */
export interface DiscoveredSection {
  section_id: string;
  source_ref: string;
  title: string;
  start_block_id: string;
  end_block_id: string;
  parameter_codes: string[];
  /**
   * Real physical pages of the endpoint blocks, derived server-side before
   * publication (design D7). Never accepted from the model and never
   * inferred from citations; optional only so older frozen payloads stay
   * readable — absence is honest, not a fabricated range.
   */
  start_page_number?: number;
  end_page_number?: number;
}

export interface DiscoveryManifest {
  sources: {
    source_ref: string;
    role: SectionRole;
    /** Owning revision stage (ПД/РД/ИД); lets the model bind matrix hints. */
    stage: string | null;
    page_count: number;
    candidates: SectionCandidate[];
  }[];
  parameters: SectionMatrixRow[];
}

/** One block inside an analysis request; text is the only quoteable source. */
export interface SubmittedBlock {
  block_id: string;
  page_number: number;
  sheet_label: string | null;
  kind: "text" | "table_cell";
  text: string;
  table: {
    table_id: string;
    /** "cell" = real table cell; "label" = text block the parser bound to the grid. */
    kind: "cell" | "label";
    row: number | null;
    column: number | null;
    row_span: number | null;
    column_span: number | null;
    /** For labels: the parser-verified row/column bindings of the text block. */
    rows: number[] | null;
    columns: number[] | null;
  } | null;
}

/** A slice of one materialized section inside a request (part/of are 1-based). */
export interface SubmittedPart {
  source_ref: string;
  role: SectionRole;
  /** Owning revision stage (ПД/РД/ИД), resolved server-side. */
  stage: string | null;
  section_id: string;
  part: number;
  part_of: number;
  blocks: SubmittedBlock[];
}

export interface SectionAnalysisRequestPayload {
  prompt_version: string;
  context: {
    scope: string;
    works_period: { from: string | null; to: string | null };
  };
  parameters: SectionMatrixRow[];
  parts: SubmittedPart[];
}

export type SectionAssessment =
  "potential_difference" | "proposed_agreement" | "insufficient_context";

/** Server-derived evidence: model never supplies page/bbox/table locators. */
export interface SectionEvidence extends EvidenceLocator {
  source_ref: string;
  role: SectionRole;
  section_id: string;
  document_id: string;
  revision_id: string;
  file_id: string;
  artifact_id: string;
}

export interface SectionCoverage {
  complete: boolean;
  /** Concrete machine-readable reasons, e.g. "chunk_omitted:sec:2". */
  missing: string[];
}

export interface SectionParameterResult {
  parameter_code: string;
  assessment: SectionAssessment;
  fact: string | null;
  evidence: SectionEvidence[];
  missing_context: string[];
  question_for_inspector: string | null;
  /**
   * Row-scoped coverage (design D3): shared source/discovery uncertainty
   * plus the gaps owned by this parameter's own sections, requests and
   * reconciliation. Always populated by new engine output; optional only
   * so older persisted payloads stay readable.
   */
  coverage?: SectionCoverage;
}

export interface SectionContextResult {
  context_id: string;
  scope: string;
  works_period: { from: string | null; to: string | null };
  reference: RevisionReference | null;
  actual: RevisionReference;
  sources: SectionSourceInfo[];
  sections: DiscoveredSection[];
  parameters: SectionParameterResult[];
  coverage: SectionCoverage;
}

export interface SectionAnalysisFailure {
  stage: "discovery" | "analysis";
  context_id: string;
  code: string;
  retryable: boolean;
}

export interface SectionAnalysisOutput {
  schema_version: 1;
  engine: string;
  analysis_basis: {
    matrix_identity: string;
    model: string;
    discovery_prompt_version: string;
    analysis_prompt_version: string;
  };
  contexts: SectionContextResult[];
  skipped_contexts: { context_id: string; reason: string }[];
  calls_used: number;
  failures: SectionAnalysisFailure[];
}

// --- Wire schemas (strict json_schema: every property is required) ---

const boundedText = (min: number, max: number) => ({
  type: "string",
  minLength: min,
  maxLength: max,
});
const ID = boundedText(1, 256);
const SOURCE_REF = {
  type: "string",
  pattern: "^[a-z]+:[0-9]{1,3}$",
  maxLength: 64,
};

export const SECTION_DISCOVERY_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sections", "expand", "missing_context"],
  properties: {
    sections: {
      type: "array",
      maxItems: 256,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "source_ref",
          "title",
          "start_block_id",
          "end_block_id",
          "parameter_codes",
        ],
        properties: {
          source_ref: SOURCE_REF,
          title: boundedText(1, 300),
          start_block_id: ID,
          end_block_id: ID,
          parameter_codes: {
            type: "array",
            // One shared section may legitimately cover the full matrix.
            maxItems: 132,
            items: boundedText(1, 64),
          },
        },
      },
    },
    expand: {
      type: "array",
      maxItems: 32,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["source_ref", "candidate_id"],
        properties: {
          source_ref: SOURCE_REF,
          candidate_id: { type: "string", minLength: 1, maxLength: 96 },
        },
      },
    },
    missing_context: {
      type: "array",
      maxItems: 32,
      items: boundedText(1, 500),
    },
  },
} as const;

export const SECTION_ANALYSIS_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["results"],
  properties: {
    results: {
      type: "array",
      minItems: 1,
      maxItems: 64,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "parameter_code",
          "assessment",
          "fact",
          "evidence",
          "missing_context",
          "question_for_inspector",
        ],
        properties: {
          parameter_code: boundedText(1, 64),
          assessment: {
            enum: [
              "potential_difference",
              "proposed_agreement",
              "insufficient_context",
            ],
          },
          fact: { type: ["string", "null"], maxLength: 4000 },
          evidence: {
            type: "array",
            maxItems: 64,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["source_ref", "block_id", "quote"],
              properties: {
                source_ref: SOURCE_REF,
                block_id: ID,
                quote: boundedText(1, 900),
              },
            },
          },
          missing_context: {
            type: "array",
            maxItems: 16,
            items: boundedText(1, 500),
          },
          question_for_inspector: { type: ["string", "null"], maxLength: 1000 },
        },
      },
    },
  },
} as const;

// --- Validators ---

const MATRIX_ROW_KEYS = [
  "parameter_code",
  "name",
  "unit",
  "source_pd",
  "source_rd",
  "source_id",
  "trigger",
] as const;
const MAX_MATRIX_ROWS = 132;
const CODE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

function boundedNullableText(
  value: unknown,
  field: string,
  max: number,
): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > max
  )
    throw new SectionAnalysisError(`section_row_invalid_${field}`, false);
  return value;
}

/** Real descriptors only: exact key set, unique bounded codes. */
export function validateSectionMatrixRows(value: unknown): SectionMatrixRow[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_MATRIX_ROWS
  )
    throw new SectionAnalysisError("section_rows_invalid", false);
  const seen = new Set<string>();
  const rows: SectionMatrixRow[] = [];
  for (const item of value) {
    if (
      !record(item) ||
      !Object.keys(item).every((key) =>
        (MATRIX_ROW_KEYS as readonly string[]).includes(key),
      )
    )
      throw new SectionAnalysisError("section_row_unknown_field", false);
    for (const key of MATRIX_ROW_KEYS)
      if (!Object.hasOwn(item, key))
        throw new SectionAnalysisError("section_row_missing_field", false);
    if (
      typeof item.parameter_code !== "string" ||
      !CODE.test(item.parameter_code)
    )
      throw new SectionAnalysisError("section_row_invalid_code", false);
    if (seen.has(item.parameter_code))
      throw new SectionAnalysisError("section_row_duplicate_code", false);
    seen.add(item.parameter_code);
    if (
      typeof item.name !== "string" ||
      !item.name.trim() ||
      item.name.length > 2000 ||
      typeof item.trigger !== "string" ||
      !item.trigger.trim() ||
      item.trigger.length > 4000
    )
      throw new SectionAnalysisError("section_row_invalid_text", false);
    rows.push({
      parameter_code: item.parameter_code,
      name: item.name,
      unit: boundedNullableText(item.unit, "unit", 64),
      source_pd: boundedNullableText(item.source_pd, "source_pd", 500),
      source_rd: boundedNullableText(item.source_rd, "source_rd", 500),
      source_id: boundedNullableText(item.source_id, "source_id", 500),
      trigger: item.trigger,
    });
  }
  return rows;
}

export interface DiscoveryCandidateIndex {
  /** candidate_id -> candidate */
  candidates: Map<string, SectionCandidate>;
  /** `${source_ref}\n${block_id}` -> anchor candidate + position in reading order */
  anchors: Map<string, { candidate: SectionCandidate; position: number }>;
  /**
   * source_ref -> every legal boundary end -> position of the anchor that
   * follows it. Validation accepts any entry strictly after the anchor's own
   * position, so exact ends are never silently unrepresentable.
   */
  endAnchors: Map<string, Map<string, number>>;
  /** source_ref -> id of the last stream block (document-tail end). */
  lastBlockIds: Map<string, string>;
  sourceRefs: Set<string>;
  requestedCodes: Set<string>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function invalid(code = "section_discovery_invalid"): never {
  throw new SectionAnalysisError(code, false);
}

export interface DiscoveryResponseValid {
  sections: Omit<DiscoveredSection, "section_id">[];
  expand: { source_ref: string; candidate_id: string }[];
  missing_context: string[];
}

/**
 * Strict boundary validation. Starts are submitted candidate anchors only;
 * ends must come from that anchor's precomputed real possibilities, so foreign
 * ids, reversed ranges and cross-source bounds cannot validate.
 */
export function validateDiscoveryResponse(
  value: unknown,
  index: DiscoveryCandidateIndex,
): DiscoveryResponseValid {
  if (
    !record(value) ||
    !exactKeys(value, ["sections", "expand", "missing_context"])
  )
    invalid();
  if (!Array.isArray(value.sections) || value.sections.length > 256) invalid();
  const requested = index.requestedCodes;
  const seen = new Set<string>();
  const sections: DiscoveryResponseValid["sections"] = [];
  for (const item of value.sections) {
    if (
      !record(item) ||
      !exactKeys(item, [
        "source_ref",
        "title",
        "start_block_id",
        "end_block_id",
        "parameter_codes",
      ]) ||
      typeof item.source_ref !== "string" ||
      typeof item.title !== "string" ||
      !item.title.trim() ||
      item.title.length > 300 ||
      typeof item.start_block_id !== "string" ||
      typeof item.end_block_id !== "string"
    )
      invalid();
    if (!index.sourceRefs.has(item.source_ref))
      invalid("section_discovery_foreign_source");
    const anchor = index.anchors.get(
      `${item.source_ref}\n${item.start_block_id}`,
    );
    if (!anchor) invalid("section_discovery_unknown_anchor");
    // Legal ends: the anchor itself, the last stream block, or any boundary
    // end followed by a later anchor. Reversed and foreign ids cannot pass.
    const endOk =
      item.end_block_id === anchor.candidate.block_id ||
      index.lastBlockIds.get(item.source_ref) === item.end_block_id ||
      (index.endAnchors.get(item.source_ref)?.get(item.end_block_id) ?? -1) >
        anchor.position;
    if (!endOk) invalid("section_discovery_invalid_end");
    if (
      !Array.isArray(item.parameter_codes) ||
      item.parameter_codes.length > MAX_MATRIX_ROWS ||
      !item.parameter_codes.every(
        (code) => typeof code === "string" && requested.has(code),
      )
    )
      invalid("section_discovery_foreign_parameter");
    const key = `${item.source_ref}\n${item.start_block_id}\n${item.end_block_id}`;
    if (seen.has(key)) invalid("section_discovery_duplicate_section");
    seen.add(key);
    sections.push({
      source_ref: item.source_ref,
      title: item.title.trim(),
      start_block_id: item.start_block_id,
      end_block_id: item.end_block_id,
      parameter_codes: [...new Set(item.parameter_codes as string[])],
    });
  }
  if (!Array.isArray(value.expand) || value.expand.length > 32) invalid();
  const expand: DiscoveryResponseValid["expand"] = [];
  const expandSeen = new Set<string>();
  for (const item of value.expand) {
    if (
      !record(item) ||
      !exactKeys(item, ["source_ref", "candidate_id"]) ||
      typeof item.source_ref !== "string" ||
      typeof item.candidate_id !== "string" ||
      !index.candidates.has(item.candidate_id) ||
      index.candidates.get(item.candidate_id)!.source_ref !== item.source_ref
    )
      invalid("section_discovery_foreign_expansion");
    const key = `${item.source_ref}\n${item.candidate_id}`;
    if (!expandSeen.has(key)) {
      expandSeen.add(key);
      expand.push({
        source_ref: item.source_ref,
        candidate_id: item.candidate_id,
      });
    }
  }
  if (
    !Array.isArray(value.missing_context) ||
    value.missing_context.length > 32 ||
    !value.missing_context.every(
      (item) => typeof item === "string" && item.trim() && item.length <= 500,
    )
  )
    invalid();
  return {
    sections,
    expand,
    missing_context: (value.missing_context as string[]).map((item) =>
      item.trim(),
    ),
  };
}

/** Index of one submitted analysis request for evidence validation. */
export interface AnalysisRequestIndex {
  codes: Set<string>;
  /** `${source_ref}\n${block_id}` -> submitted block */
  blocks: Map<string, { role: SectionRole; text: string }>;
  sourceRefs: Map<string, SectionRole>;
}

export interface AnalysisItemValid {
  parameter_code: string;
  assessment: SectionAssessment;
  fact: string | null;
  evidence: { source_ref: string; block_id: string; quote: string }[];
  missing_context: string[];
  question_for_inspector: string | null;
}

/**
 * Strict per-request fact validation: every requested code exactly once,
 * evidence only on blocks actually submitted in this request, quotes are exact
 * nonempty substrings, and a grounded assessment cites both roles.
 */
export function validateAnalysisResponse(
  value: unknown,
  request: AnalysisRequestIndex,
): AnalysisItemValid[] {
  if (!record(value) || !exactKeys(value, ["results"]))
    invalid("section_analysis_invalid");
  if (
    !Array.isArray(value.results) ||
    value.results.length === 0 ||
    value.results.length > 64
  )
    invalid("section_analysis_invalid");
  const answered = new Set<string>();
  const items: AnalysisItemValid[] = [];
  for (const item of value.results) {
    if (
      !record(item) ||
      !exactKeys(item, [
        "parameter_code",
        "assessment",
        "fact",
        "evidence",
        "missing_context",
        "question_for_inspector",
      ])
    )
      invalid("section_analysis_invalid");
    const {
      parameter_code,
      assessment,
      fact,
      evidence,
      missing_context,
      question_for_inspector,
    } = item;
    if (
      typeof parameter_code !== "string" ||
      !request.codes.has(parameter_code)
    )
      invalid("section_analysis_unknown_parameter");
    if (answered.has(parameter_code))
      invalid("section_analysis_duplicate_parameter");
    answered.add(parameter_code);
    if (
      assessment !== "potential_difference" &&
      assessment !== "proposed_agreement" &&
      assessment !== "insufficient_context"
    )
      invalid("section_analysis_invalid");
    if (fact !== null && (typeof fact !== "string" || fact.length > 4000))
      invalid("section_analysis_invalid");
    if (
      question_for_inspector !== null &&
      (typeof question_for_inspector !== "string" ||
        question_for_inspector.length > 1000)
    )
      invalid("section_analysis_invalid");
    if (
      !Array.isArray(missing_context) ||
      missing_context.length > 16 ||
      !missing_context.every(
        (entry) =>
          typeof entry === "string" && entry.trim() && entry.length <= 500,
      )
    )
      invalid("section_analysis_invalid");
    if (!Array.isArray(evidence) || evidence.length > 64)
      invalid("section_analysis_invalid");
    const resolved: AnalysisItemValid["evidence"] = [];
    const evidenceSeen = new Set<string>();
    let referenceCited = false;
    let actualCited = false;
    for (const entry of evidence) {
      if (
        !record(entry) ||
        !exactKeys(entry, ["source_ref", "block_id", "quote"]) ||
        typeof entry.source_ref !== "string" ||
        typeof entry.block_id !== "string" ||
        typeof entry.quote !== "string" ||
        !entry.quote.trim() ||
        entry.quote.length > 900
      )
        invalid("section_analysis_invalid");
      if (request.sourceRefs.get(entry.source_ref) === undefined)
        invalid("section_analysis_foreign_source");
      const block = request.blocks.get(
        `${entry.source_ref}\n${entry.block_id}`,
      );
      if (!block) invalid("section_analysis_foreign_block");
      if (!block.text.includes(entry.quote))
        invalid("section_analysis_quote_mismatch");
      if (block.role === "reference") referenceCited = true;
      else actualCited = true;
      const dedupe = `${entry.source_ref}\n${entry.block_id}\n${entry.quote}`;
      if (!evidenceSeen.has(dedupe)) {
        evidenceSeen.add(dedupe);
        resolved.push({
          source_ref: entry.source_ref,
          block_id: entry.block_id,
          quote: entry.quote,
        });
      }
    }
    if (assessment === "insufficient_context") {
      if (missing_context.length === 0)
        invalid("section_analysis_missing_reason");
    } else {
      // A grounded claim must cite both sides of the comparison in this
      // request; agreement can never be inferred from one role alone.
      if (!referenceCited || !actualCited || resolved.length === 0)
        invalid("section_analysis_one_sided_evidence");
      if (typeof fact !== "string" || !fact.trim())
        invalid("section_analysis_empty_fact");
    }
    items.push({
      parameter_code,
      assessment,
      fact: typeof fact === "string" ? fact.trim() || null : null,
      evidence: resolved,
      missing_context: (missing_context as string[]).map((entry) =>
        entry.trim(),
      ),
      question_for_inspector:
        typeof question_for_inspector === "string"
          ? question_for_inspector.trim() || null
          : null,
    });
  }
  for (const code of request.codes)
    if (!answered.has(code)) invalid("section_analysis_missing_parameter");
  return items;
}
