// Verification-side mapping of published section-analysis results (D7).
// This file is the boundary where persisted core output is re-validated and
// turned into protocol-builder input; it never invents Extraction/RuleVersion
// ids and never calls a provider.

import { createHash } from "node:crypto";

import type {
  Prisma,
  SectionAnalysisTask,
} from "../../generated/prisma/client.js";
import { canonicalJson } from "../documents/canonical-json.js";
import type {
  DiscoveredSection,
  SectionAnalysisOutput,
  SectionAssessment,
  SectionCoverage,
  SectionEvidence,
  SectionMatrixRow,
  SectionParameterResult,
  SectionSourceInfo,
} from "../extraction/section-contract.js";
import { validateSectionMatrixRows } from "../extraction/section-contract.js";
import type { RevisionReference } from "../identification/identification-contract.js";
import { record } from "../parsing/parsing-contract.js";
import type { FindingStatusValue } from "./verification-contract.js";

export const SECTION_ANALYSIS_SNAPSHOT_VERSION = 1;
export const SECTION_ANALYSIS_PORT = "SECTION_ANALYSIS_PORT";

/**
 * Provider-free read port implemented by SectionAnalysisJobsService
 * (extraction module) and bound via `useExisting` in VerificationModule —
 * production wiring is real, not optional. `selectedTask` returns the single
 * current basis: the task of the latest newly admitted request (D6).
 */
export interface SectionResultsPort {
  selectedTask(
    client: Prisma.TransactionClient,
    runId: string,
  ): Promise<SectionAnalysisTask | null>;
  /**
   * Whether the task's pinned basis (source fingerprint, matrix import,
   * config, cycle) still holds for the current run — identical resolved
   * input with a changed model/config/matrix is stale and must be ignored.
   */
  taskBasisHolds(
    client: Prisma.TransactionClient,
    task: Pick<
      SectionAnalysisTask,
      | "id"
      | "runId"
      | "fingerprint"
      | "resolvedInputHash"
      | "sourceFingerprint"
      | "matrixImportId"
      | "configFingerprint"
    >,
  ): Promise<boolean>;
  /**
   * Feature flag + nonsecret config identity. While disabled the whole
   * section flow is inert: no task is evaluated and legacy protocols behave
   * exactly as if the feature did not exist; frozen payloads stay readable.
   */
  executorState(): { enabled: boolean; configFingerprint: string | null };
}

/** Task states whose requested work must complete before protocol use. */
export const SECTION_TASK_PENDING_STATES = ["queued", "processing"] as const;

/**
 * One parameter's section result inside one comparison context, pinned with
 * everything the frozen snapshot and the inspector need later: matrix basis,
 * sources, section bounds, coverage and the admitted task/result basis.
 */
export interface SectionFindingInput {
  parameter_code: string;
  /** Comparison context id — the finding scope_key. */
  context_id: string;
  assessment: SectionAssessment;
  fact: string | null;
  question_for_inspector: string | null;
  missing_context: string[];
  evidence: SectionEvidence[];
  coverage: SectionCoverage;
  context: {
    context_id: string;
    scope: string;
    works_period: { from: string | null; to: string | null };
    reference: RevisionReference | null;
    actual: RevisionReference;
  };
  sources: SectionSourceInfo[];
  /** Sections covering this parameter (or cited by its evidence). */
  sections: DiscoveredSection[];
  /** Frozen admitted matrix descriptor; null only in historical payloads. */
  matrix: SectionMatrixRow | null;
  analysis_basis: SectionAnalysisOutput["analysis_basis"];
  task_fingerprint: string;
  result_fingerprint: string;
}

/** Versioned payload stored at Finding.evidenceSnapshot.section_analysis. */
export interface SectionAnalysisSnapshot extends SectionFindingInput {
  schema_version: 1;
}

/** Protocol-level section basis recorded in protocol.content. */
export interface SectionProtocolBasis {
  task_fingerprint: string;
  result_fingerprint: string;
}

export class SectionResultInvalidError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SectionResultInvalidError";
  }
}

function invalid(code = "section_result_invalid"): never {
  throw new SectionResultInvalidError(code);
}

function str(value: unknown, code: string, max = 100_000): string {
  if (typeof value !== "string" || value.length > max) invalid(code);
  return value;
}

/** Non-blank human text; whitespace-only strings are not content. */
function visibleStr(value: unknown, code: string, max: number): string {
  const text = str(value, code, max);
  if (text.trim().length === 0) invalid(code);
  return text;
}

function nullableStr(value: unknown, code: string, max = 100_000) {
  return value === null ? null : str(value, code, max);
}

function nullableVisibleStr(value: unknown, code: string, max: number) {
  return value === null ? null : visibleStr(value, code, max);
}

function strArray(value: unknown, code: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string"))
    invalid(code);
  return value;
}

function nullableInt(value: unknown, code: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) invalid(code);
  return value;
}

/** Physical 1-based page of the owning file; null is never a page. */
function pageNumber(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
    invalid(code);
  return value;
}

function bbox(
  value: unknown,
  code: string,
): [number, number, number, number] | null {
  if (value === null) return null;
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every(
      (coordinate) =>
        typeof coordinate === "number" && Number.isFinite(coordinate),
    )
  )
    invalid(code);
  return value as [number, number, number, number];
}

function isSectionAssessment(value: unknown): value is SectionAssessment {
  return (
    value === "potential_difference" ||
    value === "proposed_agreement" ||
    value === "insufficient_context"
  );
}

function isRole(value: unknown): value is "reference" | "actual" {
  return value === "reference" || value === "actual";
}

function evidence(value: unknown): SectionEvidence {
  if (!record(value)) invalid("section_evidence_invalid");
  return {
    source_ref: visibleStr(value.source_ref, "section_evidence_invalid", 64),
    role: isRole(value.role) ? value.role : invalid("section_evidence_role"),
    section_id: visibleStr(value.section_id, "section_evidence_invalid", 256),
    document_id: visibleStr(value.document_id, "section_evidence_invalid", 256),
    revision_id: visibleStr(value.revision_id, "section_evidence_invalid", 256),
    file_id: visibleStr(value.file_id, "section_evidence_invalid", 256),
    artifact_id: visibleStr(value.artifact_id, "section_evidence_invalid", 256),
    page_number: pageNumber(value.page_number, "section_evidence_page"),
    sheet_label: nullableStr(
      value.sheet_label,
      "section_evidence_invalid",
      256,
    ),
    // Citations are exact-block references by contract (D4); null is not a
    // block locator and can never make a citation grounded.
    block_id: visibleStr(value.block_id, "section_evidence_block", 256),
    table_id: nullableStr(value.table_id, "section_evidence_invalid", 256),
    table_row: nullableInt(value.table_row, "section_evidence_invalid"),
    table_column: nullableInt(value.table_column, "section_evidence_invalid"),
    quote: visibleStr(value.quote, "section_evidence_quote", 900),
    bbox: bbox(value.bbox, "section_evidence_bbox"),
    structural_path: nullableStr(
      value.structural_path,
      "section_evidence_invalid",
      2000,
    ),
  };
}

function sourceInfo(value: unknown): SectionSourceInfo {
  if (!record(value)) invalid("section_source_invalid");
  if (
    !Array.isArray(value.pages) ||
    !value.pages.every((n) => Number.isInteger(n) && n > 0)
  )
    invalid("section_source_pages");
  return {
    source_ref: visibleStr(value.source_ref, "section_source_invalid", 64),
    role: isRole(value.role) ? value.role : invalid("section_source_role"),
    document_id: visibleStr(value.document_id, "section_source_invalid", 256),
    revision_id: visibleStr(value.revision_id, "section_source_invalid", 256),
    document_stage: nullableStr(
      value.document_stage,
      "section_source_invalid",
      64,
    ),
    file_id: visibleStr(value.file_id, "section_source_invalid", 256),
    artifact_id: visibleStr(value.artifact_id, "section_source_invalid", 256),
    artifact_sha256: visibleStr(
      value.artifact_sha256,
      "section_source_invalid",
      128,
    ),
    source_sha256: visibleStr(
      value.source_sha256,
      "section_source_invalid",
      128,
    ),
    selection_hash: nullableStr(
      value.selection_hash,
      "section_source_invalid",
      128,
    ),
    pages: value.pages as number[],
  };
}

function discoveredSection(value: unknown): DiscoveredSection {
  if (!record(value)) invalid("section_bounds_invalid");
  const page = (field: "start_page_number" | "end_page_number") =>
    value[field] === undefined
      ? undefined
      : typeof value[field] === "number" &&
          Number.isInteger(value[field]) &&
          value[field] > 0
        ? value[field]
        : invalid("section_bounds_page_invalid");
  const start_page_number = page("start_page_number");
  const end_page_number = page("end_page_number");
  // Page bounds exist only as an ordered pair inside one physical source.
  if (
    (start_page_number === undefined) !== (end_page_number === undefined) ||
    (start_page_number !== undefined && start_page_number > end_page_number!)
  )
    invalid("section_bounds_page_invalid");
  return {
    section_id: str(value.section_id, "section_bounds_invalid", 256),
    source_ref: str(value.source_ref, "section_bounds_invalid", 64),
    title: str(value.title, "section_bounds_invalid", 300),
    start_block_id: str(value.start_block_id, "section_bounds_invalid", 256),
    end_block_id: str(value.end_block_id, "section_bounds_invalid", 256),
    parameter_codes: strArray(value.parameter_codes, "section_bounds_invalid"),
    ...(start_page_number !== undefined ? { start_page_number } : {}),
    ...(end_page_number !== undefined ? { end_page_number } : {}),
  };
}

function revisionReference(value: unknown): RevisionReference {
  if (
    !record(value) ||
    typeof value.document_id !== "string" ||
    value.document_id.length === 0 ||
    typeof value.revision_id !== "string" ||
    value.revision_id.length === 0
  )
    invalid("section_context_reference");
  return { document_id: value.document_id, revision_id: value.revision_id };
}

function coverage(value: unknown): SectionCoverage {
  if (!record(value) || typeof value.complete !== "boolean")
    invalid("section_coverage_invalid");
  const missing = strArray(value.missing, "section_coverage_invalid");
  if (value.complete && missing.length > 0)
    invalid("section_coverage_inconsistent");
  return { complete: value.complete, missing };
}

function matrixRow(value: unknown): SectionMatrixRow {
  if (!record(value)) invalid("section_matrix_row_invalid");
  return {
    parameter_code: str(value.parameter_code, "section_matrix_row_invalid", 64),
    name: str(value.name, "section_matrix_row_invalid", 2000),
    unit: nullableStr(value.unit, "section_matrix_row_invalid", 64),
    source_pd: nullableStr(value.source_pd, "section_matrix_row_invalid", 500),
    source_rd: nullableStr(value.source_rd, "section_matrix_row_invalid", 500),
    source_id: nullableStr(value.source_id, "section_matrix_row_invalid", 500),
    trigger: str(value.trigger, "section_matrix_row_invalid", 4000),
  };
}

/**
 * Evidence must point at a real source and a real section of its own context:
 * role/file/artifact/document/revision come from the declared source, the
 * page must exist in that source's stream, and the section must belong to the
 * same source. A corrupted citation can never be silently rebound.
 */
function checkEvidenceOwnership(
  items: readonly SectionEvidence[],
  sources: readonly SectionSourceInfo[],
  sections: readonly DiscoveredSection[],
) {
  const sourceByRef = new Map(sources.map((s) => [s.source_ref, s]));
  const sectionById = new Map(sections.map((s) => [s.section_id, s]));
  for (const item of items) {
    const source = sourceByRef.get(item.source_ref);
    if (!source) invalid("section_evidence_foreign_source");
    if (source.role !== item.role) invalid("section_evidence_role_mismatch");
    if (
      source.file_id !== item.file_id ||
      source.artifact_id !== item.artifact_id ||
      source.document_id !== item.document_id ||
      source.revision_id !== item.revision_id
    )
      invalid("section_evidence_source_mismatch");
    if (!source.pages.includes(item.page_number))
      invalid("section_evidence_foreign_page");
    const section = sectionById.get(item.section_id);
    if (!section || section.source_ref !== item.source_ref)
      invalid("section_evidence_foreign_section");
  }
}

/**
 * Real endpoint pages must belong to the physical stream of the owning
 * source; a bound outside it is corrupt publication data.
 */
function checkSectionBoundsOwnership(
  sections: readonly DiscoveredSection[],
  sources: readonly SectionSourceInfo[],
): void {
  for (const section of sections) {
    if (section.start_page_number === undefined) continue;
    const owner = sources.find(
      (source) => source.source_ref === section.source_ref,
    );
    if (
      !owner ||
      !owner.pages.includes(section.start_page_number) ||
      !owner.pages.includes(section.end_page_number!)
    )
      invalid("section_bounds_foreign_page");
  }
}

/**
 * Strict structural re-validation of a persisted SectionAnalysisOutput. The
 * producer already validated it; this boundary check protects protocol
 * generation from corrupt or hand-edited rows — it throws, it never repairs.
 */
export function parseSectionOutput(value: unknown): SectionAnalysisOutput {
  if (!record(value) || value.schema_version !== 1)
    invalid("section_result_version");
  const basis = value.analysis_basis;
  if (
    !record(basis) ||
    typeof basis.matrix_identity !== "string" ||
    typeof basis.model !== "string" ||
    typeof basis.discovery_prompt_version !== "string" ||
    typeof basis.analysis_prompt_version !== "string"
  )
    invalid("section_result_basis");
  if (!Array.isArray(value.contexts)) invalid("section_result_contexts");
  const contexts = value.contexts.map((ctx) => {
    if (!record(ctx) || !record(ctx.works_period))
      invalid("section_context_invalid");
    const sources = Array.isArray(ctx.sources)
      ? ctx.sources.map(sourceInfo)
      : invalid("section_source_invalid");
    const sections = Array.isArray(ctx.sections)
      ? ctx.sections.map(discoveredSection)
      : invalid("section_bounds_invalid");
    if (new Set(sources.map((s) => s.source_ref)).size !== sources.length)
      invalid("section_source_duplicate");
    if (new Set(sections.map((s) => s.section_id)).size !== sections.length)
      invalid("section_bounds_duplicate");
    if (
      !sections.every((section) =>
        sources.some((source) => source.source_ref === section.source_ref),
      )
    )
      invalid("section_bounds_foreign_source");
    checkSectionBoundsOwnership(sections, sources);
    const parameters = Array.isArray(ctx.parameters)
      ? ctx.parameters.map((item) => {
          if (!record(item)) invalid("section_parameter_invalid");
          // Row-scoped coverage (D3/CR18): optional for old payloads — absent
          // means the context aggregate applies unchanged.
          const parameterCoverage =
            item.coverage === undefined ? undefined : coverage(item.coverage);
          if (
            parameterCoverage !== undefined &&
            !parameterCoverage.complete &&
            parameterCoverage.missing.length === 0
          )
            invalid("section_coverage_inconsistent");
          const parsed: SectionParameterResult = {
            parameter_code: str(
              item.parameter_code,
              "section_parameter_invalid",
              64,
            ),
            assessment: isSectionAssessment(item.assessment)
              ? item.assessment
              : invalid("section_assessment_invalid"),
            fact: nullableVisibleStr(item.fact, "section_fact_invalid", 4000),
            evidence: Array.isArray(item.evidence)
              ? item.evidence.map(evidence)
              : invalid("section_evidence_invalid"),
            missing_context: strArray(
              item.missing_context,
              "section_context_invalid",
            ),
            question_for_inspector: nullableVisibleStr(
              item.question_for_inspector,
              "section_question_invalid",
              1000,
            ),
            ...(parameterCoverage === undefined
              ? {}
              : { coverage: parameterCoverage }),
          };
          // A grounded verdict cannot survive a row's own declared coverage
          // gap — internally contradictory output is rejected, not degraded.
          if (
            parameterCoverage !== undefined &&
            !parameterCoverage.complete &&
            (parsed.assessment === "potential_difference" ||
              parsed.assessment === "proposed_agreement")
          )
            invalid("section_coverage_inconsistent");
          checkEvidenceOwnership(parsed.evidence, sources, sections);
          return parsed;
        })
      : invalid("section_parameter_invalid");
    return {
      context_id: str(ctx.context_id, "section_context_invalid", 256),
      scope: str(ctx.scope, "section_context_invalid", 256),
      works_period: {
        from: nullableStr(ctx.works_period.from, "section_context_invalid", 64),
        to: nullableStr(ctx.works_period.to, "section_context_invalid", 64),
      },
      reference:
        ctx.reference === null ? null : revisionReference(ctx.reference),
      actual: revisionReference(ctx.actual),
      sources,
      sections,
      parameters,
      coverage: coverage(ctx.coverage),
    };
  });
  // One payload can never carry two different facts for the same comparison
  // context; silently keeping the last one would lose evidence (VR6).
  if (new Set(contexts.map((ctx) => ctx.context_id)).size !== contexts.length)
    invalid("section_context_duplicate");
  const skipped = Array.isArray(value.skipped_contexts)
    ? value.skipped_contexts.map((item) => {
        if (!record(item)) invalid("section_result_invalid");
        return {
          context_id: str(item.context_id, "section_result_invalid", 256),
          reason: str(item.reason, "section_result_invalid", 500),
        };
      })
    : invalid("section_result_invalid");
  const returnedIds = new Set(contexts.map((ctx) => ctx.context_id));
  const skippedIds = new Set<string>();
  for (const item of skipped) {
    if (skippedIds.has(item.context_id) || returnedIds.has(item.context_id))
      invalid("section_context_duplicate");
    skippedIds.add(item.context_id);
  }
  const failures = Array.isArray(value.failures)
    ? value.failures.map((item) => {
        if (!record(item)) invalid("section_result_invalid");
        const stage: "discovery" | "analysis" =
          item.stage === "discovery" || item.stage === "analysis"
            ? item.stage
            : invalid("section_result_invalid");
        return {
          stage,
          context_id: str(item.context_id, "section_result_invalid", 256),
          code: str(item.code, "section_result_invalid", 256),
          retryable: item.retryable === true,
        };
      })
    : invalid("section_result_invalid");
  return {
    schema_version: 1,
    engine: str(value.engine, "section_result_invalid", 128),
    analysis_basis: {
      matrix_identity: basis.matrix_identity,
      model: basis.model,
      discovery_prompt_version: basis.discovery_prompt_version,
      analysis_prompt_version: basis.analysis_prompt_version,
    },
    contexts,
    skipped_contexts: skipped,
    calls_used:
      typeof value.calls_used === "number" && Number.isInteger(value.calls_used)
        ? value.calls_used
        : invalid("section_result_invalid"),
    failures,
  };
}

/**
 * Semantic content fingerprint of a published output — the admitted result
 * basis for provenance and protocol freshness. Run-scoped PAR ids
 * (file_id/artifact_id) are dropped; durable document/revision identities
 * and content hashes stay, so a replayed analysis of unchanged sources keeps
 * the same basis while any semantic change produces a different one.
 */
export function sectionResultFingerprint(
  output: SectionAnalysisOutput,
): string {
  const normalized = {
    ...output,
    contexts: output.contexts.map((context) => ({
      ...context,
      // Run-scoped file/artifact ids are dropped from the basis: the same
      // semantic result keeps one fingerprint across replays.
      sources: context.sources.map((source) => ({
        source_ref: source.source_ref,
        role: source.role,
        document_id: source.document_id,
        revision_id: source.revision_id,
        document_stage: source.document_stage,
        artifact_sha256: source.artifact_sha256,
        source_sha256: source.source_sha256,
        selection_hash: source.selection_hash,
        pages: source.pages,
      })),
      parameters: context.parameters.map((parameter) => ({
        ...parameter,
        evidence: parameter.evidence.map((item) => ({
          source_ref: item.source_ref,
          role: item.role,
          section_id: item.section_id,
          document_id: item.document_id,
          revision_id: item.revision_id,
          page_number: item.page_number,
          sheet_label: item.sheet_label,
          block_id: item.block_id,
          table_id: item.table_id,
          table_row: item.table_row,
          table_column: item.table_column,
          quote: item.quote,
          bbox: item.bbox,
          structural_path: item.structural_path,
        })),
      })),
    })),
  };
  return createHash("sha256").update(canonicalJson(normalized)).digest("hex");
}

/**
 * Flatten a published task into per-(parameter, context) finding inputs.
 * The task's frozen matrix_rows are validated with the core validator; every
 * returned context must cover each pinned code exactly once — unknown,
 * duplicate or missing codes mean a corrupt or foreign result and are
 * rejected rather than silently dropped.
 */
export function sectionFindingInputs(
  task: Pick<SectionAnalysisTask, "fingerprint" | "matrixRows">,
  output: SectionAnalysisOutput,
): SectionFindingInput[] {
  let rows: SectionMatrixRow[];
  try {
    rows = validateSectionMatrixRows(task.matrixRows);
  } catch {
    invalid("section_matrix_rows_invalid");
  }
  const pinned = new Set(rows.map((row) => row.parameter_code));
  const matrix = new Map(rows.map((row) => [row.parameter_code, row]));
  const resultFingerprint = sectionResultFingerprint(output);
  const inputs: SectionFindingInput[] = [];
  for (const context of output.contexts) {
    const seen = new Set<string>();
    for (const parameter of context.parameters) {
      if (!pinned.has(parameter.parameter_code))
        invalid("section_unknown_parameter");
      if (seen.has(parameter.parameter_code))
        invalid("section_duplicate_parameter");
      seen.add(parameter.parameter_code);
      const cited = new Set(parameter.evidence.map((item) => item.section_id));
      inputs.push({
        parameter_code: parameter.parameter_code,
        context_id: context.context_id,
        assessment: parameter.assessment,
        fact: parameter.fact,
        question_for_inspector: parameter.question_for_inspector,
        missing_context: [...parameter.missing_context],
        evidence: parameter.evidence,
        // Effective row coverage (CR18): the row's own scoped coverage when
        // the engine published it, else the context aggregate (old payloads).
        coverage: parameter.coverage ?? context.coverage,
        context: {
          context_id: context.context_id,
          scope: context.scope,
          works_period: context.works_period,
          reference: context.reference,
          actual: context.actual,
        },
        sources: context.sources,
        sections: context.sections.filter(
          (section) =>
            section.parameter_codes.includes(parameter.parameter_code) ||
            cited.has(section.section_id),
        ),
        matrix: matrix.get(parameter.parameter_code) ?? null,
        analysis_basis: output.analysis_basis,
        task_fingerprint: task.fingerprint,
        result_fingerprint: resultFingerprint,
      });
    }
    for (const code of pinned)
      if (!seen.has(code)) invalid("section_missing_parameter");
  }
  return inputs;
}

/** Versioned immutable payload for Finding.evidenceSnapshot.section_analysis. */
export function toSectionSnapshot(
  input: SectionFindingInput,
): SectionAnalysisSnapshot {
  return { schema_version: 1, ...input };
}

/** Read a frozen section payload back without trusting the row shape. */
export function readSectionSnapshot(
  value: unknown,
): SectionAnalysisSnapshot | null {
  if (!record(value) || value.schema_version !== 1) return null;
  try {
    const sources = Array.isArray(value.sources)
      ? value.sources.map(sourceInfo)
      : invalid("section_snapshot_invalid");
    const sections = Array.isArray(value.sections)
      ? value.sections.map(discoveredSection)
      : invalid("section_snapshot_invalid");
    const items = Array.isArray(value.evidence)
      ? value.evidence.map(evidence)
      : invalid("section_snapshot_invalid");
    checkEvidenceOwnership(items, sources, sections);
    checkSectionBoundsOwnership(sections, sources);
    const ctx = record(value.context) ? value.context : null;
    return {
      schema_version: 1,
      parameter_code: str(value.parameter_code, "x", 64),
      context_id: str(value.context_id, "x", 256),
      assessment: isSectionAssessment(value.assessment)
        ? value.assessment
        : invalid("section_snapshot_invalid"),
      fact: nullableVisibleStr(value.fact, "x", 4000),
      question_for_inspector: nullableVisibleStr(
        value.question_for_inspector,
        "x",
        1000,
      ),
      missing_context: strArray(value.missing_context, "x"),
      evidence: items,
      coverage: coverage(value.coverage),
      context: ctx
        ? {
            context_id: str(ctx.context_id, "x", 256),
            scope: str(ctx.scope, "x", 256),
            works_period: record(ctx.works_period)
              ? {
                  from: nullableStr(ctx.works_period.from, "x", 64),
                  to: nullableStr(ctx.works_period.to, "x", 64),
                }
              : { from: null, to: null },
            reference:
              ctx.reference === null || ctx.reference === undefined
                ? null
                : revisionReference(ctx.reference),
            actual: revisionReference(ctx.actual),
          }
        : invalid("section_snapshot_invalid"),
      sources,
      sections,
      matrix:
        value.matrix === null || value.matrix === undefined
          ? null
          : matrixRow(value.matrix),
      analysis_basis: record(value.analysis_basis)
        ? {
            matrix_identity: str(
              value.analysis_basis.matrix_identity,
              "x",
              256,
            ),
            model: str(value.analysis_basis.model, "x", 256),
            discovery_prompt_version: str(
              value.analysis_basis.discovery_prompt_version,
              "x",
              128,
            ),
            analysis_prompt_version: str(
              value.analysis_basis.analysis_prompt_version,
              "x",
              128,
            ),
          }
        : invalid("section_snapshot_invalid"),
      task_fingerprint: str(value.task_fingerprint, "x", 128),
      result_fingerprint: str(value.result_fingerprint, "x", 128),
    };
  } catch (error) {
    if (error instanceof SectionResultInvalidError) return null;
    throw error;
  }
}

/** Basis recorded in protocol.content; null for non-section protocols. */
export function sectionProtocolBasis(
  content: unknown,
): SectionProtocolBasis | null {
  if (!record(content)) return null;
  const basis = record(content.section_analysis)
    ? content.section_analysis
    : null;
  if (
    !basis ||
    typeof basis.task_fingerprint !== "string" ||
    typeof basis.result_fingerprint !== "string"
  )
    return null;
  return {
    task_fingerprint: basis.task_fingerprint,
    result_fingerprint: basis.result_fingerprint,
  };
}

/** Basis equality: null only equals null (both fields compared). */
export function sectionBasisEqual(
  a: SectionProtocolBasis | null,
  b: SectionProtocolBasis | null,
): boolean {
  return (
    (a?.task_fingerprint ?? null) === (b?.task_fingerprint ?? null) &&
    (a?.result_fingerprint ?? null) === (b?.result_fingerprint ?? null)
  );
}

/** Basis of the currently selected task once it has published a result. */
export function currentSectionBasis(
  task: SectionAnalysisTask | null,
): SectionProtocolBasis | null {
  if (!task || task.state !== "succeeded" || task.result === null) return null;
  return {
    task_fingerprint: task.fingerprint,
    result_fingerprint: sectionResultFingerprint(
      parseSectionOutput(task.result),
    ),
  };
}

/** True when the result carries a complete, grounded comparative fact. */
export function isSectionGrounded(input: SectionFindingInput): boolean {
  const roles = new Set(input.evidence.map((item) => item.role));
  return (
    input.matrix !== null &&
    (input.assessment === "potential_difference" ||
      input.assessment === "proposed_agreement") &&
    input.coverage.complete &&
    input.coverage.missing.length === 0 &&
    input.missing_context.length === 0 &&
    typeof input.fact === "string" &&
    input.fact.length > 0 &&
    input.evidence.length > 0 &&
    roles.has("reference") &&
    roles.has("actual")
  );
}

/**
 * Status decided by a section result when the deterministic path has no
 * conclusive verdict: a complete grounded fact is a CANDIDATE pending the
 * inspector — proposed_agreement is preliminary, never NEGATIVE_VERIFIED —
 * while incomplete input stays MISSING_EVIDENCE with concrete reasons.
 */
export function sectionResultStatus(input: SectionFindingInput): {
  status: FindingStatusValue;
  reasons: string[];
} {
  if (isSectionGrounded(input)) return { status: "CANDIDATE", reasons: [] };
  const reasons: string[] = [];
  if (input.matrix === null) reasons.push("section_matrix_row_missing");
  if (input.assessment === "insufficient_context")
    reasons.push("section_context_incomplete");
  else if (input.fact === null) reasons.push("section_fact_missing");
  if (!input.coverage.complete)
    reasons.push("section_coverage_incomplete", ...input.coverage.missing);
  const roles = new Set(input.evidence.map((item) => item.role));
  if (
    (input.assessment === "potential_difference" ||
      input.assessment === "proposed_agreement") &&
    (!roles.has("reference") || !roles.has("actual"))
  )
    reasons.push("section_role_missing");
  if (
    input.missing_context.length > 0 &&
    !reasons.includes("section_context_incomplete")
  )
    reasons.push("section_context_incomplete");
  return { status: "MISSING_EVIDENCE", reasons };
}

/** Whether section evidence exists (gate "evidence present" for this path). */
export function sectionHasEvidence(input: SectionFindingInput): boolean {
  return input.evidence.length > 0;
}

/**
 * Semantic fingerprint of what the inspector saw in the section payload:
 * fact, assessment, question, missing context, coverage, section bounds,
 * exact evidence, the model/prompt/matrix basis AND the admitted task/result
 * basis — the frozen payload includes the admitted input/config identity, so
 * a re-admitted analysis is a different basis and must not inherit decisions.
 * Run-scoped file/artifact ids are replaced by content hashes so a replayed
 * parse of unchanged sources keeps the same fingerprint.
 */
export function sectionFingerprint(
  input: SectionFindingInput,
  fileSha256: Map<string, string>,
): string {
  const sourceByRef = new Map(
    input.sources.map((source) => [source.source_ref, source]),
  );
  const semanticEvidence = input.evidence.map((item) => ({
    source_ref: item.source_ref,
    role: item.role,
    section_id: item.section_id,
    document_id: item.document_id,
    revision_id: item.revision_id,
    file: fileSha256.get(item.file_id) ?? item.file_id,
    artifact:
      sourceByRef.get(item.source_ref)?.artifact_sha256 ?? item.artifact_id,
    page_number: item.page_number,
    sheet_label: item.sheet_label,
    block_id: item.block_id,
    table_id: item.table_id,
    table_row: item.table_row,
    table_column: item.table_column,
    quote: item.quote,
    bbox: item.bbox,
    structural_path: item.structural_path,
  }));
  const semanticSources = input.sources.map((source) => ({
    source_ref: source.source_ref,
    role: source.role,
    document_id: source.document_id,
    revision_id: source.revision_id,
    document_stage: source.document_stage,
    artifact_sha256: source.artifact_sha256,
    source_sha256: source.source_sha256,
    selection_hash: source.selection_hash,
    pages: source.pages,
  }));
  return createHash("sha256")
    .update(
      canonicalJson({
        parameter_code: input.parameter_code,
        context_id: input.context_id,
        assessment: input.assessment,
        fact: input.fact,
        question_for_inspector: input.question_for_inspector,
        missing_context: input.missing_context,
        coverage: input.coverage,
        sections: input.sections,
        evidence: semanticEvidence,
        sources: semanticSources,
        matrix: input.matrix,
        analysis_basis: input.analysis_basis,
        task_fingerprint: input.task_fingerprint,
        result_fingerprint: input.result_fingerprint,
      }),
    )
    .digest("hex");
}
