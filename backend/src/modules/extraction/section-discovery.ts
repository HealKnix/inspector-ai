import { createHash } from "node:crypto";
import { canonicalJson } from "../documents/canonical-json.js";
import type { ParseBlock } from "../parsing/parsing-contract.js";
import { blockText, normalizeTerm } from "./block-search.js";
import type { ResolvedSource, StreamBlock } from "./section-context.js";
import type {
  DiscoveryCandidateIndex,
  DiscoveryManifest,
  SectionCandidate,
  SectionMatrixRow,
} from "./section-contract.js";
import { utf8Bytes } from "./section-contract.js";

const MAX_CANDIDATE_TEXT = 240;
const MAX_NEIGHBOR_TEXT = 120;
const MAX_EXPANSION_NEIGHBORS = 4;
const MAX_EXPANSION_ENDS = 16;
const MAX_END_TEXT = 200;
const MAX_POSSIBLE_ENDS = 32;

const NUMBERED_HEADING = /^\d{1,2}(?:\.\d{1,3}){0,5}[.)]?\s+\S/;
// \b never fires after Cyrillic letters; require whitespace/punctuation/end.
const KEYWORD_HEADING =
  /^(?:раздел|подраздел|глава|часть|приложение|состав|общие\s+данные|перечень)(?=$|[\s.,;:()«»"])/i;
const PATH_HEADING = /heading|title|h[1-6]|заголовок|оглавление/i;
// TOC line: caption followed by a dot/space leader and a trailing page number.
const TOC_ENTRY = /^\S.{1,180}?(?:\.{3,}|…+|\t|\s{4,})\s*\d{1,4}\s*$/;
const LETTER = /\p{L}/u;

/**
 * Recurring headers/stamps repeat identical text in a page margin on at least
 * two distinct pages — a one-page document can never prove recurrence. They
 * are excluded from candidate ranking only — section bodies keep them.
 * bbox is [x0, y0, x1, y1] relative to the visible page area.
 */
function chromeBlocks(source: ResolvedSource): Set<string> {
  const seen = new Map<
    string,
    { pages: Set<number>; margin: boolean; ids: string[] }
  >();
  for (const item of source.stream) {
    const text = normalizeTerm(blockText(item.block));
    if (!text) continue;
    const entry = seen.get(text) ?? {
      pages: new Set(),
      margin: true,
      ids: [],
    };
    entry.pages.add(item.page.page_number);
    entry.ids.push(item.block.id);
    const [, top, , bottom] = item.block.bbox;
    if (top > 0.12 && bottom < 0.88) entry.margin = false;
    seen.set(text, entry);
  }
  const chrome = new Set<string>();
  for (const entry of seen.values())
    if (entry.margin && entry.pages.size >= 2)
      for (const id of entry.ids) chrome.add(id);
  return chrome;
}

function candidateKind(block: ParseBlock): "heading" | "toc_entry" | null {
  const text = blockText(block);
  if (!text || text.length > MAX_CANDIDATE_TEXT) return null;
  if (TOC_ENTRY.test(text)) return "toc_entry";
  if (block.structural_path && PATH_HEADING.test(block.structural_path))
    return "heading";
  if (NUMBERED_HEADING.test(text) || KEYWORD_HEADING.test(text))
    return "heading";
  const words = text.split(/\s+/);
  if (
    text.length <= 90 &&
    words.length >= 2 &&
    words.length <= 8 &&
    LETTER.test(text) &&
    text === text.toUpperCase()
  )
    return "heading";
  return null;
}

function snippet(text: string, max: number): string | null {
  const trimmed = text.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export interface SourceCandidateScan {
  candidates: SectionCandidate[];
  /** anchor block_id -> its position in this source's anchor order */
  anchorPositions: Map<string, number>;
  /**
   * Every legal boundary end (the block before each later anchor) -> the
   * position of the anchor following it. Shared per source: O(anchors) total
   * while preserving every exact usable endpoint for validation.
   */
  endAnchors: Map<string, number>;
  lastBlockId: string | null;
}

/** Pure structural candidates over the resolved stream; never LLM-derived. */
export function collectCandidates(source: ResolvedSource): SourceCandidateScan {
  const stream = source.stream;
  const chrome = chromeBlocks(source);
  const anchors: { item: StreamBlock; kind: "heading" | "toc_entry" }[] = [];
  for (const item of stream) {
    if (item.block.kind !== "text" || chrome.has(item.block.id)) continue;
    const kind = candidateKind(item.block);
    if (kind) anchors.push({ item, kind });
  }
  const anchorPositions = new Map<string, number>();
  const endAnchors = new Map<string, number>();
  for (const [position, { item }] of anchors.entries()) {
    anchorPositions.set(item.block.id, position);
    // The stream block right before this anchor is the natural end of any
    // section opened by an earlier anchor.
    const end = stream[item.index - 1];
    if (position > 0 && end) endAnchors.set(end.block.id, position);
  }
  const candidates: SectionCandidate[] = [];
  for (const [position, { item, kind }] of anchors.entries()) {
    // Manifest sample of the legal ends: own block, the immediate
    // next-boundary end, doubling distances and the stream tail — bounded,
    // never every later anchor (quadratic on heading-rich documents).
    const ends = new Set<string>([item.block.id]);
    for (
      let step = 1;
      position + step < anchors.length && ends.size < MAX_POSSIBLE_ENDS;
      step *= 2
    ) {
      const end = stream[anchors[position + step]!.item.index - 1];
      if (end) ends.add(end.block.id);
    }
    const last = stream[stream.length - 1];
    if (last) ends.add(last.block.id);
    const before = item.index > 0 ? stream[item.index - 1]! : null;
    const after =
      item.index < stream.length - 1 ? stream[item.index + 1]! : null;
    candidates.push({
      candidate_id: `${source.info.source_ref}:c${position}`,
      source_ref: source.info.source_ref,
      block_id: item.block.id,
      page_number: item.page.page_number,
      kind,
      text: snippet(blockText(item.block), MAX_CANDIDATE_TEXT) ?? "",
      structural_path: item.block.structural_path,
      possible_end_block_ids: [...ends],
      neighbors: {
        before: before
          ? snippet(blockText(before.block), MAX_NEIGHBOR_TEXT)
          : null,
        after: after
          ? snippet(blockText(after.block), MAX_NEIGHBOR_TEXT)
          : null,
      },
    });
  }
  return {
    candidates,
    anchorPositions,
    endAnchors,
    lastBlockId: stream.length ? stream[stream.length - 1]!.block.id : null,
  };
}

export interface DiscoveryManifestBuild {
  manifest: DiscoveryManifest;
  index: DiscoveryCandidateIndex;
  /** Candidates dropped by the byte budget — they count as partial coverage. */
  omitted_candidates: number;
}

/**
 * Compact manifest: every source gets an equal share of the candidate budget,
 * headings admitted before TOC entries, manifest order kept in reading order.
 * Omissions are measured, never silently dropped.
 */
export function buildDiscoveryManifest(
  sources: ResolvedSource[],
  rows: SectionMatrixRow[],
  maxCandidateBytes: number,
): DiscoveryManifestBuild {
  const perSource = Math.floor(maxCandidateBytes / Math.max(1, sources.length));
  const index: DiscoveryCandidateIndex = {
    candidates: new Map(),
    anchors: new Map(),
    endAnchors: new Map(),
    lastBlockIds: new Map(),
    sourceRefs: new Set(),
    requestedCodes: new Set(rows.map((row) => row.parameter_code)),
  };
  let omitted = 0;
  const manifestSources: DiscoveryManifest["sources"] = [];
  for (const source of sources) {
    index.sourceRefs.add(source.info.source_ref);
    const scan = collectCandidates(source);
    index.endAnchors.set(source.info.source_ref, scan.endAnchors);
    if (scan.lastBlockId !== null)
      index.lastBlockIds.set(source.info.source_ref, scan.lastBlockId);
    const all = scan.candidates;
    const admitted = new Set<SectionCandidate>();
    let used = 0;
    for (const kind of ["heading", "toc_entry"] as const) {
      for (const candidate of all) {
        if (candidate.kind !== kind) continue;
        const size = utf8Bytes(candidate);
        if (used + size > perSource) {
          omitted++;
          continue;
        }
        used += size;
        admitted.add(candidate);
      }
    }
    const ordered = all.filter((candidate) => admitted.has(candidate));
    for (const candidate of ordered) {
      index.candidates.set(candidate.candidate_id, candidate);
      index.anchors.set(`${candidate.source_ref}\n${candidate.block_id}`, {
        candidate,
        position: scan.anchorPositions.get(candidate.block_id)!,
      });
    }
    manifestSources.push({
      source_ref: source.info.source_ref,
      role: source.info.role,
      stage: source.info.document_stage,
      page_count: source.info.pages.length,
      candidates: ordered,
    });
  }
  return {
    manifest: { sources: manifestSources, parameters: rows },
    index,
    omitted_candidates: omitted,
  };
}

export interface ExpansionBlock {
  block_id: string;
  page_number: number;
  text: string;
}

export interface CandidateExpansion {
  source_ref: string;
  candidate_id: string;
  before: ExpansionBlock[];
  after: ExpansionBlock[];
  possible_ends: ExpansionBlock[];
}

/**
 * Bounded neighbor expansion around requested anchors. It only adds reading
 * context; the legal start/end set of the second pass stays the same.
 */
export function buildCandidateExpansions(
  sources: ResolvedSource[],
  index: DiscoveryCandidateIndex,
  requests: { source_ref: string; candidate_id: string }[],
  maxBytes: number,
  maxCandidates: number,
): CandidateExpansion[] {
  const byRef = new Map(
    sources.map((source) => [source.info.source_ref, source]),
  );
  const expansions: CandidateExpansion[] = [];
  let used = 0;
  const seen = new Set<string>();
  for (const request of requests) {
    if (expansions.length >= maxCandidates || used >= maxBytes) break;
    const key = `${request.source_ref}\n${request.candidate_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const candidate = index.candidates.get(request.candidate_id);
    const source = byRef.get(request.source_ref);
    if (!candidate || !source) continue;
    const stream = source.stream;
    const position = stream.findIndex(
      (item) => item.block.id === candidate.block_id,
    );
    if (position < 0) continue;
    const toBlock = (item: StreamBlock): ExpansionBlock => ({
      block_id: item.block.id,
      page_number: item.page.page_number,
      text: blockText(item.block).slice(0, MAX_END_TEXT),
    });
    const before = stream
      .slice(Math.max(0, position - MAX_EXPANSION_NEIGHBORS), position)
      .map(toBlock);
    const after = stream
      .slice(position + 1, position + 1 + MAX_EXPANSION_NEIGHBORS)
      .map(toBlock);
    const endById = new Map(
      stream.map((item) => [item.block.id, item] as const),
    );
    const possible_ends = candidate.possible_end_block_ids
      .slice(0, MAX_EXPANSION_ENDS)
      .flatMap((id) => {
        const item = endById.get(id);
        return item ? [toBlock(item)] : [];
      });
    const expansion: CandidateExpansion = {
      source_ref: request.source_ref,
      candidate_id: request.candidate_id,
      before,
      after,
      possible_ends,
    };
    const size = utf8Bytes(expansion);
    if (used + size > maxBytes) break;
    used += size;
    expansions.push(expansion);
  }
  return expansions;
}

/**
 * Semantic cache identity for a validated section index: the source_ref ->
 * content mapping itself (a reordered snapshot never replays a boundary onto
 * another artifact), resolved stage, parser pipeline, prompt/model/budget
 * versions and the pinned matrix criteria. Run, task and artifact record ids
 * are never part of it.
 */
export function sectionIndexCacheKey(input: {
  context: {
    scope: string;
    works_period: { from: string | null; to: string | null };
  };
  sources: ResolvedSource[];
  parameterCodes: string[];
  matrix_identity: string;
  model: string;
  discovery_prompt_version: string;
  engine_version: string;
  /** Endpoint identity: strict-route compatibility and call behaviour. */
  provider: {
    base_url: string;
    require_parameters: boolean;
    timeout_ms: number;
  };
  bounds: {
    max_candidate_bytes: number;
    max_expansion_bytes: number;
    max_expansion_candidates: number;
  };
}): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        engine: input.engine_version,
        prompt: input.discovery_prompt_version,
        model: input.model,
        provider: input.provider,
        bounds: input.bounds,
        matrix: input.matrix_identity,
        parameters: [...input.parameterCodes].sort(),
        context: {
          scope: input.context.scope,
          works_period: input.context.works_period,
        },
        sources: input.sources
          .map((source) => ({
            source_ref: source.info.source_ref,
            role: source.info.role,
            stage: source.info.document_stage,
            artifact_sha256: source.info.artifact_sha256,
            source_sha256: source.info.source_sha256,
            selection_hash: source.info.selection_hash,
            pages: source.info.pages,
            pipeline_fingerprint: source.view.pipeline_fingerprint,
            versions: source.view.versions,
          }))
          .sort((a, b) => a.source_ref.localeCompare(b.source_ref)),
      }),
    )
    .digest("hex");
}
