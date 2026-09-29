import type { IdentificationSnapshot } from "../identification/identification-contract.js";
import type { ParseArtifactData } from "../parsing/parsing-contract.js";
import { record } from "../parsing/parsing-contract.js";
import type { SectionAnalysisConfig } from "./section-config.js";
import type { StreamBlock } from "./section-context.js";
import { buildSectionContexts } from "./section-context.js";
import type {
  AnalysisItemValid,
  AnalysisRequestIndex,
  DiscoveredSection,
  SectionAnalysisOutput,
  SectionContextResult,
  SectionCoverage,
  SectionEvidence,
  SectionMatrixRow,
  SectionParameterResult,
  SectionRole,
  SubmittedPart,
} from "./section-contract.js";
import {
  SECTION_ANALYSIS_PROMPT_VERSION,
  SECTION_DISCOVERY_PROMPT_VERSION,
  SECTION_ENGINE_VERSION,
  SECTION_SOURCE_REF,
  SectionAnalysisError,
  validateAnalysisResponse,
  validateDiscoveryResponse,
} from "./section-contract.js";
import {
  buildCandidateExpansions,
  buildDiscoveryManifest,
  sectionIndexCacheKey,
} from "./section-discovery.js";
import { escapedPayloadBytes, sectionRequestBytes } from "./section-llm.js";
import type { MaterializedSection } from "./section-materialize.js";
import { chunkSection } from "./section-materialize.js";

/**
 * Provider port for the pure engine. The HTTP adapter lives in
 * section-llm.ts; tests inject a mock. `payload` is the exact object that
 * becomes the user message; the returned value is the unvalidated response
 * content which the engine validates against the strict contract.
 */
export interface SectionLlm {
  call(kind: "discovery" | "analysis", payload: unknown): Promise<unknown>;
}

/**
 * A validated discovery result plus the uncertainty it declared. Cached
 * missing_context is replayed into coverage on every hit — a cached index
 * never makes an incomplete discovery look complete.
 */
export interface SectionIndexCacheEntry {
  sections: DiscoveredSection[];
  missing_context: string[];
}

/**
 * Semantic index cache. Keys come from sectionIndexCacheKey — content,
 * selection, stage, pipeline, prompt/model/budget and matrix criteria, never
 * run ids. Awaitable so the durable DB store can implement it directly.
 */
export interface SectionIndexCache {
  get(
    key: string,
  ):
    | Promise<SectionIndexCacheEntry | undefined>
    | SectionIndexCacheEntry
    | undefined;
  set(key: string, entry: SectionIndexCacheEntry): Promise<void> | void;
}

/**
 * Structural validation of a persisted cache entry. A durable store returns
 * unchecked JSON — the TypeScript signature does not prove the shape, so
 * malformed arrays, fields or duplicate ids/anchors invalidate the entry.
 */
export function validateSectionIndexCacheEntry(
  value: unknown,
): SectionIndexCacheEntry | undefined {
  if (!record(value)) return undefined;
  const { sections, missing_context } = value;
  if (!Array.isArray(sections) || sections.length > 256) return undefined;
  if (!Array.isArray(missing_context) || missing_context.length > 64)
    return undefined;
  const ids = new Set<string>();
  const anchors = new Set<string>();
  const out: DiscoveredSection[] = [];
  for (const raw of sections as unknown[]) {
    if (!record(raw) || Object.keys(raw).length !== 6) return undefined;
    const section = raw;
    if (
      typeof section.section_id !== "string" ||
      !section.section_id ||
      typeof section.source_ref !== "string" ||
      !SECTION_SOURCE_REF.test(section.source_ref) ||
      typeof section.title !== "string" ||
      !section.title.trim() ||
      section.title.length > 300 ||
      typeof section.start_block_id !== "string" ||
      !section.start_block_id ||
      typeof section.end_block_id !== "string" ||
      !section.end_block_id ||
      !Array.isArray(section.parameter_codes) ||
      section.parameter_codes.length > 132 ||
      !section.parameter_codes.every(
        (code) =>
          typeof code === "string" && code.length >= 1 && code.length <= 64,
      )
    )
      return undefined;
    const anchor = `${section.source_ref}\n${section.start_block_id}`;
    if (ids.has(section.section_id) || anchors.has(anchor)) return undefined;
    ids.add(section.section_id);
    anchors.add(anchor);
    out.push({
      section_id: section.section_id,
      source_ref: section.source_ref,
      title: section.title,
      start_block_id: section.start_block_id,
      end_block_id: section.end_block_id,
      parameter_codes: (section.parameter_codes as string[]).slice(),
    });
  }
  const missing = missing_context as unknown[];
  if (
    !missing.every(
      (entry) =>
        typeof entry === "string" && entry.trim() && entry.length <= 500,
    )
  )
    return undefined;
  return {
    sections: out,
    missing_context: missing.map((entry) => (entry as string).trim()),
  };
}

export interface SectionEngineInput {
  snapshot: IdentificationSnapshot;
  artifactFor: (artifactId: string) => ParseArtifactData | null;
  rows: SectionMatrixRow[];
  /** Semantic identity of the matrix release (hash/version), never run ids. */
  matrix_identity: string;
  config: SectionAnalysisConfig;
  llm: SectionLlm;
  cache?: SectionIndexCache;
}

/** One submitted block with its server-side provenance for locators. */
interface SubmittedBlockRef {
  item: StreamBlock;
  role: SectionRole;
  section_id: string;
  text: string;
}

interface RequestPlan {
  parameters: SectionMatrixRow[];
  parts: SubmittedPart[];
  /**
   * `${source_ref}\n${block_id}` -> provenance of the submitted block. One
   * block can sit inside several overlapping sections — every owning
   * section is kept so evidence binds to a section that covers the row.
   */
  blocks: Map<string, SubmittedBlockRef[]>;
  sourceRefs: Map<string, SectionRole>;
}

interface PendingChunk {
  materialized: MaterializedSection;
  chunkIndex: number;
}

function toPart(pending: PendingChunk): SubmittedPart {
  const { materialized, chunkIndex } = pending;
  const chunk = materialized.chunks[chunkIndex]!;
  return {
    source_ref: materialized.source.info.source_ref,
    role: materialized.source.info.role,
    stage: materialized.source.info.document_stage,
    section_id: materialized.section.section_id,
    part: chunkIndex + 1,
    part_of: materialized.chunks.length,
    blocks: chunk.blocks,
  };
}

/**
 * Pack all chunks of the sections covering one parameter batch into
 * size-bounded requests. Roles alternate so a request carries both sides
 * whenever chunks remain — a grounded assessment can only cite blocks that
 * were submitted together. Returns the requests plus the chunks that could
 * not be packed at all (a single part above the request bound).
 */
function packRequests(
  batch: SectionMatrixRow[],
  covering: MaterializedSection[],
  contextBase: {
    scope: string;
    works_period: { from: string | null; to: string | null };
  },
  config: SectionAnalysisConfig,
): { requests: RequestPlan[]; unpackable: PendingChunk[] } {
  const pending: Record<SectionRole, PendingChunk[]> = {
    reference: [],
    actual: [],
  };
  for (const m of covering)
    for (let chunkIndex = 0; chunkIndex < m.chunks.length; chunkIndex++)
      pending[m.source.info.role].push({ materialized: m, chunkIndex });
  // Exact wire accounting: the budget is what callSectionLlm will actually
  // send — envelope, schema, system prompt and string-escaped user content,
  // not the bare payload object.
  const overhead = sectionRequestBytes(config, "analysis", {
    prompt_version: SECTION_ANALYSIS_PROMPT_VERSION,
    context: contextBase,
    parameters: batch,
    parts: [],
  });
  const requests: RequestPlan[] = [];
  while (pending.reference.length || pending.actual.length) {
    const plan: RequestPlan = {
      parameters: batch,
      parts: [],
      blocks: new Map(),
      sourceRefs: new Map(),
    };
    let bytes = overhead;
    let role: SectionRole = pending.reference.length ? "reference" : "actual";
    for (;;) {
      // Try the alternating role first, then the other head; pack whichever
      // fits. If neither head fits, this request (possibly empty) is done.
      const other: SectionRole = role === "reference" ? "actual" : "reference";
      const heads = [role, other]
        .map((r) => {
          const next = pending[r][0];
          if (!next) return null;
          const part = toPart(next);
          return { role: r, next, part, size: escapedPayloadBytes(part) };
        })
        .filter((h): h is NonNullable<typeof h> => h !== null);
      // The separator counts too: a non-first part also adds its comma.
      const separator = plan.parts.length ? 1 : 0;
      const fit = heads.find(
        (h) => bytes + separator + h.size <= config.maxRequestBytes,
      );
      if (!fit) break;
      pending[fit.role].shift();
      // Exact serialized size: overhead counted "parts":[] already; each
      // subsequent element adds its own bytes plus one comma separator.
      bytes += fit.size + (plan.parts.length ? 1 : 0);
      plan.parts.push(fit.part);
      plan.sourceRefs.set(fit.part.source_ref, fit.role);
      const chunk = fit.next.materialized.chunks[fit.next.chunkIndex]!;
      for (const [i, item] of chunk.stream.entries()) {
        const key = `${fit.part.source_ref}\n${item.block.id}`;
        const owners = plan.blocks.get(key) ?? [];
        owners.push({
          item,
          role: fit.role,
          section_id: fit.part.section_id,
          text: chunk.blocks[i]!.text,
        });
        plan.blocks.set(key, owners);
      }
      role = other;
    }
    if (!plan.parts.length) break; // both heads exceed an empty request
    requests.push(plan);
  }
  return {
    requests,
    unpackable: [...pending.reference, ...pending.actual],
  };
}

/** Deterministic section ids in stable order, assigned after validation. */
function assignSectionIds(
  sections: Omit<DiscoveredSection, "section_id">[],
): DiscoveredSection[] {
  return sections.map((section, i) => ({
    ...section,
    section_id: `sec${i}`,
  }));
}

/** server-side locator derivation — model locators are never trusted. */
function locatorOf(item: StreamBlock, quote: string) {
  const { block, page } = item;
  return {
    page_number: page.page_number,
    sheet_label: page.sheet_label,
    block_id: block.id,
    table_id:
      block.table_link?.status === "ambiguous"
        ? null
        : (block.table_id ?? block.table_link?.table_id ?? null),
    table_row: block.row,
    table_column: block.column,
    quote,
    bbox: [...block.bbox] as [number, number, number, number],
    structural_path: block.structural_path,
  };
}

interface ContextRun {
  result: SectionContextResult;
  calls: number;
  failure?: {
    stage: "discovery" | "analysis";
    code: string;
    retryable: boolean;
  };
}

function insufficientResults(
  rows: SectionMatrixRow[],
  missing: string[],
): SectionParameterResult[] {
  const context =
    missing.length > 0
      ? missing.slice(0, 16)
      : ["источник недоступен или контекст неполон"];
  const coverage: SectionCoverage = {
    complete: false,
    missing: [...missing],
  };
  return rows.map((row) => ({
    parameter_code: row.parameter_code,
    assessment: "insufficient_context",
    fact: null,
    evidence: [],
    missing_context: [...context],
    question_for_inspector: null,
    coverage,
  }));
}

function toError(error: unknown): SectionAnalysisError {
  return error instanceof SectionAnalysisError
    ? error
    : new SectionAnalysisError("section_llm_transport_error", true);
}

/**
 * Run one READY context end to end: discovery (cached by semantic key),
 * materialization of every validated boundary, batched analysis and strict
 * reconciliation. No grounded assessment survives incomplete coverage.
 */
async function runContext(
  plan: ReturnType<typeof buildSectionContexts>["plans"][number],
  input: SectionEngineInput,
  callsLeft: { remaining: number },
): Promise<ContextRun> {
  const { context, sources, blockers } = plan;
  const rows = input.rows;
  // Coverage scopes (design D3): `shared` is uncertainty that cannot be
  // attributed to specific parameters — source and discovery problems that
  // revoke every row conservatively. `local` holds gaps owned by a
  // parameter's own sections, requests and reconciliation: an unanswered
  // neighbour must not erase a fully covered row. `aggregate` carries
  // run-level facts (call budget) already fully described by the row-local
  // gaps they produced, so they inform the context without revoking rows.
  const sharedMissing: string[] = [];
  const aggregateMissing: string[] = [];
  const localMissing = new Map<string, string[]>();
  const sharedSeen = new Set<string>();
  const aggregateSeen = new Set<string>();
  const localSeen = new Map<string, Set<string>>();
  const bounded = (list: string[], seen: Set<string>, entry: string): void => {
    if (seen.has(entry)) return;
    seen.add(entry);
    if (list.length >= 512) {
      bounded(list, seen, "missing_truncated");
      return;
    }
    list.push(entry);
  };
  const noteShared = (entry: string) =>
    bounded(sharedMissing, sharedSeen, entry);
  const noteAggregate = (entry: string) =>
    bounded(aggregateMissing, aggregateSeen, entry);
  const noteLocal = (codes: Iterable<string>, entry: string) => {
    for (const code of codes) {
      let seen = localSeen.get(code);
      if (!seen) localSeen.set(code, (seen = new Set()));
      let list = localMissing.get(code);
      if (!list) localMissing.set(code, (list = []));
      bounded(list, seen, entry);
    }
  };
  // Context-level merged view: every gap exactly once.
  const mergedMissing = (): string[] => {
    const merged = [...sharedMissing, ...aggregateMissing];
    const seen = new Set(merged);
    for (const list of localMissing.values())
      for (const entry of list)
        if (!seen.has(entry)) {
          seen.add(entry);
          merged.push(entry);
        }
    return merged;
  };
  const rowCoverage = (code: string): SectionCoverage => {
    const missing = [...sharedMissing, ...(localMissing.get(code) ?? [])];
    return { complete: missing.length === 0, missing };
  };
  for (const blocker of blockers) noteShared(`context_blocker:${blocker}`);
  const base = {
    context_id: context.context_id,
    scope: context.scope,
    works_period: context.works_period,
    reference: context.reference,
    actual: context.actual,
    sources: sources.map((s) => s.info),
  };
  let calls = 0;
  const hasRole = (role: SectionRole) =>
    sources.some((s) => s.info.role === role);
  if (!hasRole("reference") || !hasRole("actual")) {
    if (!blockers.length) noteShared("context_blocker:role_missing");
    return {
      result: {
        ...base,
        sections: [],
        parameters: insufficientResults(rows, mergedMissing()),
        coverage: { complete: false, missing: mergedMissing() },
      },
      calls,
    };
  }

  // --- Discovery (validated, once, with a bounded expansion pass) ---
  const { manifest, index, omitted_candidates } = buildDiscoveryManifest(
    sources,
    rows,
    input.config.maxCandidateBytes,
  );
  // Candidate omissions are partial coverage even when chunks process fully.
  if (omitted_candidates)
    noteShared(`discovery_candidates_omitted:${omitted_candidates}`);
  const cacheKey = sectionIndexCacheKey({
    context: { scope: context.scope, works_period: context.works_period },
    sources,
    parameterCodes: rows.map((r) => r.parameter_code),
    matrix_identity: input.matrix_identity,
    model: input.config.model,
    discovery_prompt_version: SECTION_DISCOVERY_PROMPT_VERSION,
    engine_version: SECTION_ENGINE_VERSION,
    provider: {
      base_url: input.config.baseUrl,
      require_parameters: input.config.requireParameters,
      timeout_ms: input.config.timeoutMs,
    },
    bounds: {
      max_candidate_bytes: input.config.maxCandidateBytes,
      max_expansion_bytes: input.config.maxCandidateBytes,
      max_expansion_candidates: input.config.maxExpansionCandidates,
    },
  });
  const stored = await input.cache?.get(cacheKey);
  // A persisted entry is unchecked JSON: validate structure before any
  // semantic revalidation, then replay stored uncertainty verbatim.
  const cached = stored ? validateSectionIndexCacheEntry(stored) : undefined;
  if (stored && !cached) noteShared("cache_entry_invalid");
  let discovered: DiscoveredSection[] | undefined;
  if (cached) {
    // Cached uncertainty replays verbatim — a hit never looks more complete.
    for (const entry of cached.missing_context) noteShared(entry);
    // Cached boundaries are revalidated against the current candidate/source
    // index: stale ids degrade to explicit missing, never throw mid-run. The
    // gap belongs to the dropped section's own parameter codes — an
    // unrelated row keeps whatever fresh coverage it has.
    const revalidated: DiscoveredSection[] = [];
    for (const section of cached.sections) {
      const anchor = index.anchors.get(
        `${section.source_ref}\n${section.start_block_id}`,
      );
      const endOk =
        !!anchor &&
        (section.end_block_id === anchor.candidate.block_id ||
          index.lastBlockIds.get(section.source_ref) === section.end_block_id ||
          (index.endAnchors
            .get(section.source_ref)
            ?.get(section.end_block_id) ?? -1) > anchor.position);
      if (
        anchor &&
        endOk &&
        index.sourceRefs.has(section.source_ref) &&
        typeof section.title === "string" &&
        section.title.trim() &&
        section.parameter_codes.length <= index.requestedCodes.size &&
        section.parameter_codes.every((code) => index.requestedCodes.has(code))
      )
        revalidated.push(section);
      else noteLocal(section.parameter_codes, "cache_revalidation_dropped");
    }
    discovered = revalidated;
  }
  if (!discovered) {
    const ask = (expansions: unknown) =>
      input.llm.call("discovery", {
        prompt_version: SECTION_DISCOVERY_PROMPT_VERSION,
        context: {
          scope: context.scope,
          works_period: context.works_period,
        },
        manifest,
        expansions,
      });
    try {
      if (callsLeft.remaining <= 0)
        throw new SectionAnalysisError("section_call_budget_exhausted", false);
      callsLeft.remaining--;
      calls++;
      const first = validateDiscoveryResponse(await ask([]), index);
      const discoveryMissing: string[] = [];
      const noteDiscovery = (entry: string) => {
        noteShared(entry);
        discoveryMissing.push(entry);
      };
      for (const item of first.missing_context)
        noteDiscovery(`discovery_missing:${item}`);
      // Sections keyed by (source, start): a corrected second-pass boundary
      // REPLACES the earlier guess for the same anchor, never coexists.
      const byAnchor = new Map<string, Omit<DiscoveredSection, "section_id">>();
      for (const section of first.sections)
        byAnchor.set(
          `${section.source_ref}\n${section.start_block_id}`,
          section,
        );
      let unserved = 0;
      if (first.expand.length) {
        const expansions =
          input.config.maxExpansionCandidates > 0 && callsLeft.remaining > 0
            ? buildCandidateExpansions(
                sources,
                index,
                first.expand,
                input.config.maxCandidateBytes,
                input.config.maxExpansionCandidates,
              )
            : [];
        unserved += first.expand.length - expansions.length;
        if (expansions.length) {
          callsLeft.remaining--;
          calls++;
          const second = validateDiscoveryResponse(
            await ask(expansions),
            index,
          );
          for (const item of second.missing_context)
            noteDiscovery(`discovery_missing:${item}`);
          // A third pass would be unbounded; every request left in
          // second.expand is explicit missing coverage.
          unserved += second.expand.length;
          for (const section of second.sections)
            byAnchor.set(
              `${section.source_ref}\n${section.start_block_id}`,
              section,
            );
        }
      }
      if (unserved > 0) noteDiscovery(`expansion_unserved:${unserved}`);
      discovered = assignSectionIds([...byAnchor.values()]);
      await input.cache?.set(cacheKey, {
        sections: discovered,
        missing_context: discoveryMissing,
      });
    } catch (error) {
      const sectionError = toError(error);
      noteShared(`discovery_failed:${sectionError.code}`);
      return {
        result: {
          ...base,
          sections: [],
          parameters: insufficientResults(rows, mergedMissing()),
          coverage: { complete: false, missing: mergedMissing() },
        },
        calls,
        failure: {
          stage: "discovery",
          code: sectionError.code,
          retryable: sectionError.retryable,
        },
      };
    }
  }

  // --- Materialization: full inclusive ranges, table-aware chunks ---
  const byRef = new Map(sources.map((s) => [s.info.source_ref, s]));
  const materialized: MaterializedSection[] = [];
  for (const section of discovered) {
    const source = byRef.get(section.source_ref);
    if (!source) continue; // unreachable: sources are validated per request
    const m = chunkSection(
      source,
      section,
      input.config.maxChunkBytes,
      input.config.maxBlockCharacters,
    );
    // Materialization gaps belong to the section's own parameter codes: a
    // filtered block inside one row's section must not erase a fully
    // covered neighbour row.
    for (const id of m.omitted_block_ids)
      noteLocal(
        section.parameter_codes,
        `block_omitted:${section.section_id}:${id}`,
      );
    // Blocks removed by analysis eligibility on touched pages can never be
    // cited — the section is honestly incomplete where they existed.
    for (const id of m.filtered_block_ids)
      noteLocal(
        section.parameter_codes,
        `content_filtered:${section.section_id}:${id}`,
      );
    for (const pageNumber of m.unreadable_pages)
      noteLocal(
        section.parameter_codes,
        `page_unreadable:${section.section_id}:${pageNumber}`,
      );
    for (const regionId of m.unresolved_regions)
      noteLocal(
        section.parameter_codes,
        `region_unresolved:${section.section_id}:${regionId}`,
      );
    materialized.push(m);
  }
  // Published bounds carry the real physical pages of the endpoint blocks
  // (design D7). Cache entries and the wire schema stay minimal; a section
  // whose endpoints cannot be located simply keeps no page range.
  const publishedSections = discovered.map((section) => {
    const source = byRef.get(section.source_ref);
    const start = source?.stream.find(
      (item) => item.block.id === section.start_block_id,
    );
    const end = source?.stream.find(
      (item) => item.block.id === section.end_block_id,
    );
    if (!start || !end) return { ...section };
    return {
      ...section,
      start_page_number: start.page.page_number,
      end_page_number: end.page.page_number,
    };
  });

  // --- Analysis: >1 real MatrixRow per request; all chunks or missing ---
  // Required observations are tracked per row: only responses from requests
  // that actually carried a chunk of a section covering that row count —
  // unrelated batch chunks must not force a row permanently incomplete.
  const rowSections = new Map<string, Set<string>>();
  for (const m of materialized)
    for (const code of m.section.parameter_codes) {
      const set = rowSections.get(code) ?? new Set<string>();
      set.add(m.section.section_id);
      rowSections.set(code, set);
    }
  const answered = new Map<
    string,
    {
      item: AnalysisItemValid;
      blocks: Map<string, SubmittedBlockRef[]>;
      relevant: boolean;
    }[]
  >();
  const submittedRefs = new Map<string, SubmittedBlockRef[]>();
  const batches: SectionMatrixRow[][] = [];
  for (let i = 0; i < rows.length; i += input.config.maxParametersPerRequest)
    batches.push(rows.slice(i, i + input.config.maxParametersPerRequest));
  let analysisFailure: ContextRun["failure"];
  for (const batch of batches) {
    const batchCodes = new Set(batch.map((r) => r.parameter_code));
    const covering = materialized.filter((m) =>
      m.section.parameter_codes.some((code) => batchCodes.has(code)),
    );
    const { requests, unpackable } = packRequests(
      batch,
      covering,
      { scope: context.scope, works_period: context.works_period },
      input.config,
    );
    for (const pending of unpackable)
      noteLocal(
        pending.materialized.section.parameter_codes,
        `chunk_unprocessed:${pending.materialized.section.section_id}:${pending.chunkIndex + 1}/${pending.materialized.chunks.length}`,
      );
    for (const request of requests) {
      if (callsLeft.remaining <= 0) {
        for (const part of request.parts)
          noteLocal(
            materialized.find((m) => m.section.section_id === part.section_id)
              ?.section.parameter_codes ?? [],
            `chunk_unprocessed:${part.section_id}:${part.part}/${part.part_of}`,
          );
        noteAggregate("call_budget_exhausted");
        continue;
      }
      callsLeft.remaining--;
      calls++;
      const requestIndex: AnalysisRequestIndex = {
        codes: batchCodes,
        blocks: new Map(
          [...request.blocks].map(([key, refs]) => [
            key,
            { role: refs[0]!.role, text: refs[0]!.text },
          ]),
        ),
        sourceRefs: request.sourceRefs,
      };
      try {
        const raw = await input.llm.call("analysis", {
          prompt_version: SECTION_ANALYSIS_PROMPT_VERSION,
          context: {
            scope: context.scope,
            works_period: context.works_period,
          },
          parameters: request.parameters,
          parts: request.parts,
        });
        const items = validateAnalysisResponse(raw, requestIndex);
        const carried = new Set(request.parts.map((p) => p.section_id));
        for (const item of items) {
          // An observation is required for a row only when this request
          // carried at least one chunk of a section covering it.
          const relevant = [
            ...(rowSections.get(item.parameter_code) ?? []),
          ].some((id) => carried.has(id));
          const list = answered.get(item.parameter_code) ?? [];
          list.push({ item, blocks: request.blocks, relevant });
          answered.set(item.parameter_code, list);
        }
        for (const [key, refs] of request.blocks) {
          const existing = submittedRefs.get(key) ?? [];
          const known = new Set(existing.map((r) => r.section_id));
          for (const ref of refs)
            if (!known.has(ref.section_id)) existing.push(ref);
          submittedRefs.set(key, existing);
        }
      } catch (error) {
        const sectionError = toError(error);
        analysisFailure ??= {
          stage: "analysis",
          code: sectionError.code,
          retryable: sectionError.retryable,
        };
        for (const part of request.parts)
          noteLocal(
            materialized.find((m) => m.section.section_id === part.section_id)
              ?.section.parameter_codes ?? [],
            `chunk_unprocessed:${part.section_id}:${part.part}/${part.part_of}`,
          );
        for (const row of batch)
          noteLocal(
            [row.parameter_code],
            `analysis_failed:${row.parameter_code}:${sectionError.code}`,
          );
        break;
      }
    }
  }

  // --- Bounded LLM reconciliation for multi-observation parameters ---
  // When a row's sections span several requests, the partial observations
  // plus the exact cited source blocks are re-submitted for a final verdict;
  // the strict validator re-checks every quote against those blocks.
  const finals = new Map<
    string,
    { item: AnalysisItemValid; observations: AnalysisItemValid[] }
  >();
  const unreconciled: string[] = [];
  for (const row of rows) {
    const required = (answered.get(row.parameter_code) ?? [])
      .filter((e) => e.relevant)
      .map((e) => e.item);
    if (required.length === 1)
      finals.set(row.parameter_code, {
        item: required[0]!,
        observations: required,
      });
    else if (required.length > 1) unreconciled.push(row.parameter_code);
  }
  // Reconciliation is itself an analysis request: it honours the same
  // configured row, body and call budgets, batching rows rather than
  // overflowing one call or the 64-item response schema.
  for (
    let i = 0;
    i < unreconciled.length;
    i += input.config.maxParametersPerRequest
  ) {
    const group = unreconciled.slice(
      i,
      i + input.config.maxParametersPerRequest,
    );
    // Every cited source block of every required observation, verbatim.
    const cited = new Map<
      string,
      { source_ref: string; block_id: string; text: string; role: SectionRole }
    >();
    const observations: {
      parameter_code: string;
      responses: AnalysisItemValid[];
    }[] = [];
    for (const code of group) {
      const required = (answered.get(code) ?? [])
        .filter((e) => e.relevant)
        .map((e) => e.item);
      observations.push({ parameter_code: code, responses: required });
      for (const item of required)
        for (const ev of item.evidence) {
          const key = `${ev.source_ref}\n${ev.block_id}`;
          if (cited.has(key)) continue;
          const ref = submittedRefs.get(key)?.[0];
          if (!ref) continue;
          cited.set(key, {
            source_ref: ev.source_ref,
            block_id: ev.block_id,
            text: ref.text,
            role: ref.role,
          });
        }
    }
    const payload = {
      prompt_version: SECTION_ANALYSIS_PROMPT_VERSION,
      context: {
        scope: context.scope,
        works_period: context.works_period,
      },
      parameters: rows.filter((row) => group.includes(row.parameter_code)),
      observations,
      cited_blocks: [...cited.values()],
    };
    if (callsLeft.remaining <= 0) {
      for (const code of group)
        noteLocal([code], `reconciliation_unserved:${code}`);
      noteAggregate(`reconciliation_unserved:${group.length}`);
      continue;
    }
    if (
      sectionRequestBytes(input.config, "analysis", payload) >
      input.config.maxRequestBytes
    ) {
      for (const code of group)
        noteLocal([code], `reconciliation_unsupported:${code}`);
      noteAggregate(`reconciliation_unsupported:${group.length}`);
      continue;
    }
    const reconcileIndex: AnalysisRequestIndex = {
      codes: new Set(group),
      blocks: new Map(
        [...cited.values()].map((block) => [
          `${block.source_ref}\n${block.block_id}`,
          { role: block.role, text: block.text },
        ]),
      ),
      sourceRefs: new Map(
        [...cited.values()].map((block) => [block.source_ref, block.role]),
      ),
    };
    callsLeft.remaining--;
    calls++;
    try {
      const raw = await input.llm.call("analysis", payload);
      const items = validateAnalysisResponse(raw, reconcileIndex);
      for (const item of items)
        finals.set(item.parameter_code, {
          item,
          observations:
            observations.find((o) => o.parameter_code === item.parameter_code)
              ?.responses ?? [],
        });
    } catch (error) {
      const sectionError = toError(error);
      analysisFailure ??= {
        stage: "analysis",
        code: sectionError.code,
        retryable: sectionError.retryable,
      };
      for (const code of group)
        noteLocal([code], `reconciliation_failed:${code}:${sectionError.code}`);
      noteAggregate(`reconciliation_failed:${sectionError.code}`);
    }
  }
  for (const code of unreconciled)
    if (!finals.has(code)) {
      // Keep all partial missing_context visible even without a verdict.
      const responses = (answered.get(code) ?? [])
        .filter((e) => e.relevant)
        .map((e) => e.item);
      finals.set(code, {
        item: {
          parameter_code: code,
          assessment: "insufficient_context",
          fact: null,
          evidence: [],
          missing_context: responses.flatMap((o) => o.missing_context),
          question_for_inspector: null,
        },
        observations: responses,
      });
    }

  // --- Final assembly: a grounded verdict needs its OWN coverage clean ---
  // Row-level gaps are recorded before coverage is measured — a gap noted
  // during assembly (unanswered rows, truncated observation context) must
  // still land in that row's local set and in the context aggregate.
  const prepared = new Map<
    string,
    { missingContext: string[]; question: string | null }
  >();
  for (const row of rows) {
    const final = finals.get(row.parameter_code);
    const observations = final?.observations ?? [];
    const modelMissing = [
      ...(final?.item.missing_context ?? []),
      ...observations.flatMap((o) => o.missing_context),
    ];
    const missingContext = [...new Set(modelMissing)].slice(0, 16);
    if (modelMissing.length > 16)
      noteLocal(
        [row.parameter_code],
        `observation_context_truncated:${row.parameter_code}`,
      );
    if (!final)
      noteLocal([row.parameter_code], `row_unanswered:${row.parameter_code}`);
    prepared.set(row.parameter_code, {
      missingContext,
      question:
        final?.item.question_for_inspector ??
        observations.find((o) => o.question_for_inspector)
          ?.question_for_inspector ??
        null,
    });
  }
  const missing = mergedMissing();
  const complete = missing.length === 0;
  const parameters: SectionParameterResult[] = rows.map((row) => {
    const final = finals.get(row.parameter_code);
    const { missingContext, question } = prepared.get(row.parameter_code)!;
    const coverage = rowCoverage(row.parameter_code);
    const unsupported = (fallback: string[]): SectionParameterResult => ({
      parameter_code: row.parameter_code,
      assessment: "insufficient_context" as const,
      fact: null,
      evidence: [],
      missing_context: missingContext.length ? missingContext : fallback,
      question_for_inspector: question,
      coverage,
    });
    if (!final)
      // A row whose relevant chunks never reached the model is an explicit
      // coverage gap, not merely an unanswered form.
      return unsupported(["разделы параметра не были отправлены на анализ"]);
    // Model-declared missing context is itself unresolved: no grounded
    // verdict may carry it, and the row's own shared+local coverage must
    // be clean — a neighbour's gap cannot revoke this row's coverage.
    const grounded =
      coverage.complete &&
      final.item.assessment !== "insufficient_context" &&
      missingContext.length === 0;
    if (!grounded)
      return unsupported(
        coverage.missing.length
          ? coverage.missing.slice(0, 16)
          : ["наблюдения по частям раздела неоднозначны"],
      );
    const rowSectionIds = rowSections.get(row.parameter_code) ?? new Set();
    const evidence: SectionEvidence[] = [];
    const evidenceSeen = new Set<string>();
    for (const ev of final.item.evidence) {
      if (evidence.length >= 64) break;
      const key = `${ev.source_ref}\n${ev.block_id}\n${ev.quote}`;
      if (evidenceSeen.has(key)) continue;
      evidenceSeen.add(key);
      const source = byRef.get(ev.source_ref)!;
      const refs = submittedRefs.get(`${ev.source_ref}\n${ev.block_id}`) ?? [];
      // Overlapping sections share blocks: prefer an owner covering the row.
      const ref = refs.find((r) => rowSectionIds.has(r.section_id)) ?? refs[0];
      if (!ref) continue;
      evidence.push({
        source_ref: ev.source_ref,
        role: source.info.role,
        section_id: ref.section_id,
        document_id: source.info.document_id,
        revision_id: source.info.revision_id,
        file_id: source.info.file_id,
        artifact_id: source.info.artifact_id,
        ...locatorOf(ref.item, ev.quote),
      });
    }
    return {
      parameter_code: row.parameter_code,
      assessment: final.item.assessment,
      fact: final.item.fact,
      evidence,
      missing_context: missingContext,
      question_for_inspector: question,
      coverage,
    };
  });
  return {
    result: {
      ...base,
      sections: publishedSections,
      parameters,
      coverage: { complete, missing },
    },
    calls,
    failure: analysisFailure,
  };
}

/**
 * Pure orchestration over resolved READY contexts. Discovery indexes are
 * reusable through the injected semantic cache; all provider traffic goes
 * through the injected SectionLlm port under a global call budget.
 */
export async function runSectionAnalysis(
  input: SectionEngineInput,
): Promise<SectionAnalysisOutput> {
  const { plans, skipped } = buildSectionContexts(
    input.snapshot,
    input.artifactFor,
  );
  const contexts: SectionContextResult[] = [];
  const failures: SectionAnalysisOutput["failures"] = [];
  const callsLeft = { remaining: input.config.maxCalls };
  let callsUsed = 0;
  for (const plan of plans) {
    const run = await runContext(plan, input, callsLeft);
    contexts.push(run.result);
    callsUsed += run.calls;
    if (run.failure)
      failures.push({ context_id: plan.context.context_id, ...run.failure });
  }
  return {
    schema_version: 1,
    engine: SECTION_ENGINE_VERSION,
    analysis_basis: {
      matrix_identity: input.matrix_identity,
      model: input.config.model,
      discovery_prompt_version: SECTION_DISCOVERY_PROMPT_VERSION,
      analysis_prompt_version: SECTION_ANALYSIS_PROMPT_VERSION,
    },
    contexts,
    skipped_contexts: skipped,
    calls_used: callsUsed,
    failures,
  };
}
