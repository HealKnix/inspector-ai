import type {
  ComparisonContext,
  IdentificationRevision,
  IdentificationSnapshot,
  RevisionReference,
} from "../identification/identification-contract.js";
import { analysisBlocks } from "../parsing/analysis-blocks.js";
import type {
  ParseArtifactData,
  ParseBlock,
  ParsePage,
} from "../parsing/parsing-contract.js";
import type { SectionRole, SectionSourceInfo } from "./section-contract.js";
import { selectedArtifactView } from "./selected-artifact.js";

/** One analysis-eligible block inside a resolved source stream. */
export interface StreamBlock {
  block: ParseBlock;
  page: ParsePage;
  index: number;
}

/**
 * A single physical artifact view bound to one comparison role. Composed sheet
 * selections spanning several files yield one source per artifact — section
 * boundaries never cross source_ref boundaries.
 */
export interface ResolvedSource {
  info: SectionSourceInfo;
  view: ParseArtifactData;
  stream: StreamBlock[];
}

export interface SectionContextPlan {
  context: ComparisonContext;
  sources: ResolvedSource[];
  /** Context-level blockers; they force insufficient_context on every row. */
  blockers: string[];
}

export interface SectionContextSelection {
  plans: SectionContextPlan[];
  skipped: { context_id: string; reason: string }[];
}

/** Analysis-eligible blocks in document reading order for one source view. */
export function sourceStream(view: ParseArtifactData): StreamBlock[] {
  const stream: StreamBlock[] = [];
  for (const page of view.pages)
    for (const block of analysisBlocks(page))
      stream.push({ block, page, index: stream.length });
  return stream;
}

/**
 * Immutable ordering key for one physical source: content hashes first, then
 * owner identity. Deliberately excludes artifact_id/file record ids so the
 * same semantic input always yields the same wire refs.
 */
function semanticKey(source: ResolvedSource): string {
  return [
    source.info.role,
    source.info.artifact_sha256,
    source.info.source_sha256,
    source.info.revision_id,
    source.info.file_id,
    source.info.selection_hash ?? "",
  ].join("\n");
}

function revisionOf(
  snapshot: IdentificationSnapshot,
  ref: RevisionReference | null,
): IdentificationRevision | null {
  if (!ref) return null;
  return (
    snapshot.documents
      .find((doc) => doc.document_id === ref.document_id)
      ?.revisions.find((rev) => rev.revision_id === ref.revision_id) ?? null
  );
}

function makeSource(
  info: Omit<SectionSourceInfo, "source_ref" | "pages">,
  view: ParseArtifactData,
): ResolvedSource {
  return {
    info: { ...info, source_ref: "", pages: [] },
    view,
    stream: sourceStream(view),
  };
}

/**
 * Resolve the sources of one role. A resolved sheet set may span several
 * artifacts (inherited sheets keep their original file/revision); each
 * artifact becomes an independent source whose content is filtered by
 * selectedArtifactView before any candidate discovery happens, and whose
 * identity comes from the ResolvedSheet itself, not the pairing reference.
 */
function roleSources(
  snapshot: IdentificationSnapshot,
  context: ComparisonContext,
  role: SectionRole,
  ref: RevisionReference | null,
  artifactFor: (artifactId: string) => ParseArtifactData | null,
  blockers: string[],
): ResolvedSource[] {
  const revision = revisionOf(snapshot, ref);
  if (!ref || !revision) {
    blockers.push(`section_source_missing:${role}`);
    return [];
  }
  const selection = context.sheet_selection?.[role] ?? null;
  const sources: ResolvedSource[] = [];
  if (selection) {
    const artifactIds = [
      ...new Set(selection.sheets.map((sheet) => sheet.artifact_id)),
    ];
    for (const artifactId of artifactIds) {
      const sheets = selection.sheets.filter(
        (sheet) => sheet.artifact_id === artifactId,
      );
      // Sheets of one artifact must agree on their physical owner; mixed
      // identities would silently merge different revisions into one source.
      const first = sheets[0]!;
      const consistent = sheets.every(
        (sheet) =>
          sheet.document_id === first.document_id &&
          sheet.revision_id === first.revision_id &&
          sheet.file_id === first.file_id &&
          sheet.artifact_sha256 === first.artifact_sha256 &&
          sheet.source_sha256 === first.source_sha256,
      );
      const owner = consistent
        ? revisionOf(snapshot, {
            document_id: first.document_id,
            revision_id: first.revision_id,
          })
        : null;
      if (!consistent || !owner) {
        blockers.push(`section_selection_mismatch:${role}`);
        continue;
      }
      const artifact = artifactFor(artifactId);
      if (!artifact) {
        blockers.push(`section_source_unavailable:${role}`);
        continue;
      }
      try {
        const view = selectedArtifactView(artifact, artifactId, selection);
        sources.push(
          makeSource(
            {
              role,
              document_id: first.document_id,
              revision_id: first.revision_id,
              document_stage: owner.fields.stage ?? null,
              file_id: first.file_id,
              artifact_id: artifactId,
              artifact_sha256: first.artifact_sha256,
              source_sha256: first.source_sha256,
              selection_hash: selection.selection_hash,
            },
            view,
          ),
        );
      } catch {
        // Stale or inconsistent sheet evidence prevents comparison on this
        // source; it is explicit missing context, never a fallback.
        blockers.push(`section_selection_mismatch:${role}`);
      }
    }
    return sources;
  }
  if (revision.sheet_map || revision.sheet_replacement) {
    blockers.push(`sheet_selection_unresolved:${role}`);
    return [];
  }
  for (const rep of revision.representations) {
    const artifact = artifactFor(rep.artifact_id);
    if (!artifact || artifact.source_sha256 !== rep.source_sha256) {
      blockers.push(`section_source_unavailable:${role}`);
      continue;
    }
    sources.push(
      makeSource(
        {
          role,
          document_id: ref.document_id,
          revision_id: ref.revision_id,
          document_stage: revision.fields.stage ?? null,
          file_id: rep.file_id,
          artifact_id: rep.artifact_id,
          artifact_sha256: rep.artifact_sha256,
          source_sha256: rep.source_sha256,
          selection_hash: null,
        },
        artifact,
      ),
    );
  }
  return sources;
}

/**
 * Only explicit READY contexts supply paired sources. Scope, period and
 * revision pairing are fixed by the snapshot; CLARIFICATION_REQUIRED contexts
 * are skipped and reported, never guessed at.
 */
export function buildSectionContexts(
  snapshot: IdentificationSnapshot,
  artifactFor: (artifactId: string) => ParseArtifactData | null,
): SectionContextSelection {
  const plans: SectionContextPlan[] = [];
  const skipped: SectionContextSelection["skipped"] = [];
  for (const context of snapshot.contexts) {
    if (context.status !== "READY") {
      skipped.push({
        context_id: context.context_id,
        reason: "context_not_ready",
      });
      continue;
    }
    const blockers: string[] = [...context.blockers];
    const sources = [
      ...roleSources(
        snapshot,
        context,
        "reference",
        context.reference,
        artifactFor,
        blockers,
      ),
      ...roleSources(
        snapshot,
        context,
        "actual",
        context.actual,
        artifactFor,
        blockers,
      ),
    ];
    // Number wire refs by immutable semantic identity, not iteration order:
    // representation reorder must never rebind a source_ref to another file,
    // or a cached boundary could be replayed against the wrong artifact.
    sources.sort((a, b) => semanticKey(a).localeCompare(semanticKey(b)));
    const counts = { reference: 0, actual: 0 };
    for (const source of sources) {
      const ordinal = counts[source.info.role]++;
      source.info.source_ref = `${source.info.role}:${ordinal}`;
      source.info.pages = source.view.pages.map((page) => page.page_number);
    }
    plans.push({ context, sources, blockers });
  }
  return { plans, skipped };
}
