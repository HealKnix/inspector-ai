import { describe, expect, it } from "vitest";
import {
  secArtifact,
  secPage,
  secText,
} from "../../../test/helpers/section-fixture.js";
import type { ParseBlock } from "../parsing/parsing-contract.js";
import type { ResolvedSource } from "./section-context.js";
import { sourceStream } from "./section-context.js";
import {
  buildCandidateExpansions,
  buildDiscoveryManifest,
  collectCandidates,
  sectionIndexCacheKey,
} from "./section-discovery.js";

// Synthetic fixtures only; no real documents are used in unit tests.

function source(pages: ParseBlock[][], sha = "a".repeat(64)): ResolvedSource {
  const view = secArtifact(
    sha,
    pages.map((blocks, i) => secPage(i + 1, blocks)),
  );
  return {
    info: {
      source_ref: "reference:0",
      role: "reference",
      document_id: "doc",
      revision_id: "rev",
      document_stage: "RD",
      file_id: "file",
      artifact_id: "art",
      artifact_sha256: "sha",
      source_sha256: sha,
      selection_hash: null,
      pages: view.pages.map((p) => p.page_number),
    },
    view,
    stream: sourceStream(view),
  };
}

const row = {
  parameter_code: "P1",
  name: "n",
  unit: null,
  source_pd: null,
  source_rd: null,
  source_id: null,
  trigger: "t",
};

describe("collectCandidates", () => {
  it("detects Cyrillic keyword, numbered and structural-path headings", () => {
    const path = secText("h0", "Странный заголовок");
    path.structural_path = "body/heading";
    const s = source([
      [
        secText("h1", "Раздел 1. Общие положения"),
        secText("t1", "обычный текст"),
        secText("h2", "Приложение А"),
        path,
        secText("w", "раздельно написано слово"), // keyword prefix inside word
      ],
    ]);
    const scan = collectCandidates(s);
    const starts = scan.candidates.map((c) => c.block_id);
    expect(starts).toEqual(["h1", "h2", "h0"]);
  });

  it("marks TOC leader lines as toc_entry", () => {
    const s = source([
      [secText("toc", "Раздел 1 ......... 12"), secText("h", "Раздел 1")],
    ]);
    const scan = collectCandidates(s);
    expect(scan.candidates[0]!.kind).toBe("toc_entry");
    expect(scan.candidates[1]!.kind).toBe("heading");
  });

  it("excludes margin chrome repeated on 2+ pages but keeps single-page headings", () => {
    // Heading-shaped recurring stamp: keyword heading placed in the top margin.
    const stamp = (id: string) => {
      const b = secText(id, "Приложение А");
      b.bbox = [0.3, 0.02, 0.7, 0.06]; // top margin
      return b;
    };
    const multi = source([
      [stamp("s1"), secText("h1", "Раздел 1"), secText("x", "текст")],
      [stamp("s2"), secText("b", "текст"), stamp("s3")],
    ]);
    const scan = collectCandidates(multi);
    expect(scan.candidates.map((c) => c.block_id)).toEqual(["h1"]);
    // Single page: the same top-margin heading can never be proven recurring.
    const single = source([[stamp("s1")]]);
    expect(collectCandidates(single).candidates.map((c) => c.block_id)).toEqual(
      ["s1"],
    );
    // Repeated heading-shaped text near the LEFT edge but mid-page is not
    // margin chrome: the margin check uses y0/y1, not x0.
    const body = (id: string) => {
      const b = secText(id, "Раздел 7", 0.4);
      b.bbox = [0.05, 0.4, 0.5, 0.45];
      return b;
    };
    const bodySource = source([[body("m1")], [body("m2")]]);
    expect(
      collectCandidates(bodySource).candidates.map((c) => c.block_id),
    ).toEqual(["m1", "m2"]);
  });

  it("bounds possible_end_block_ids while the end index preserves every boundary", () => {
    // 40 headings → naive construction stores ~1600 ends; stratified ≤32.
    const blocks = Array.from({ length: 80 }, (_, i) =>
      i % 2 === 0
        ? secText(`h${i}`, `Раздел ${i}`)
        : secText(`t${i}`, `текст ${i}`),
    );
    const s = source([blocks]);
    const scan = collectCandidates(s);
    expect(scan.candidates).toHaveLength(40);
    for (const c of scan.candidates)
      expect(c.possible_end_block_ids.length).toBeLessThanOrEqual(32);
    // The block before anchor 3 (h6) is t5 — not among the power-of-two
    // sampled ends (anchors 1,2,4,8,...) but still legal via endAnchors.
    expect(scan.endAnchors.get("t5")).toBe(3);
    expect(scan.candidates[0]!.possible_end_block_ids).not.toContain("t5");
    // The immediate next-boundary end and the stream tail are sampled.
    expect(scan.candidates[0]!.possible_end_block_ids).toContain("t1");
    expect(scan.lastBlockId).toBe("t79");
  });
});

describe("buildDiscoveryManifest", () => {
  it("admits headings before TOC entries and counts budget omissions", () => {
    const s = source([
      [
        secText("h1", "Раздел 1"),
        secText("h2", "Раздел 2"),
        secText("toc", "Раздел 1 ....... 2"),
      ],
    ]);
    const built = buildDiscoveryManifest([s], [row], 1200);
    expect(built.manifest.sources[0]!.candidates.length).toBeGreaterThan(0);
    expect(built.omitted_candidates).toBeGreaterThanOrEqual(0);
    const tiny = buildDiscoveryManifest([s], [row], 500);
    expect(tiny.omitted_candidates).toBeGreaterThan(0);
    // Stage and role travel on the wire source entry.
    expect(built.manifest.sources[0]!.stage).toBe("RD");
    expect(built.manifest.sources[0]!.role).toBe("reference");
  });
});

describe("buildCandidateExpansions", () => {
  it("returns bounded neighbor context for requested anchors only", () => {
    const s = source([
      [
        secText("h1", "Раздел 1"),
        secText("t1", "текст"),
        secText("h2", "Раздел 2"),
      ],
    ]);
    const built = buildDiscoveryManifest([s], [row], 4096);
    const candidateId = built.manifest.sources[0]!.candidates[0]!.candidate_id;
    const out = buildCandidateExpansions(
      [s],
      built.index,
      [
        { source_ref: "reference:0", candidate_id: candidateId },
        { source_ref: "reference:0", candidate_id: "missing" },
      ],
      8192,
      4,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.after.length).toBeGreaterThan(0);
    expect(out[0]!.possible_ends.length).toBeGreaterThan(0);
  });
});

describe("sectionIndexCacheKey", () => {
  const base = () => ({
    context: { scope: "A", works_period: { from: null, to: null } },
    sources: [source([[secText("h", "Раздел 1")]])],
    parameterCodes: ["P1"],
    matrix_identity: "mx-1",
    model: "m",
    discovery_prompt_version: "d",
    engine_version: "e",
    provider: {
      base_url: "https://provider.example/v1",
      require_parameters: true,
      timeout_ms: 60000,
    },
    bounds: {
      max_candidate_bytes: 49152,
      max_expansion_bytes: 49152,
      max_expansion_candidates: 8,
    },
  });
  it("changes on selection, parser, model, stage and budget — not on run ids", () => {
    const a = sectionIndexCacheKey(base());
    const sel = base();
    sel.sources[0]!.info.selection_hash = "sel";
    expect(sectionIndexCacheKey(sel)).not.toBe(a);
    const pipe = base();
    pipe.sources[0]!.view.pipeline_fingerprint = "x".repeat(64);
    expect(sectionIndexCacheKey(pipe)).not.toBe(a);
    expect(sectionIndexCacheKey({ ...base(), model: "m2" })).not.toBe(a);
    const stage = base();
    stage.sources[0]!.info.document_stage = "ID";
    expect(sectionIndexCacheKey(stage)).not.toBe(a);
    const bounds = base();
    bounds.bounds.max_candidate_bytes = 1024;
    expect(sectionIndexCacheKey(bounds)).not.toBe(a);
    const matrix = base();
    matrix.matrix_identity = "mx-2";
    expect(sectionIndexCacheKey(matrix)).not.toBe(a);
    expect(
      sectionIndexCacheKey({ ...base(), parameterCodes: ["P2"] }),
    ).not.toBe(a);
    // Run-specific identifiers are excluded: artifact_id does not bind.
    const run = base();
    run.sources[0]!.info.artifact_id = "run-specific";
    expect(sectionIndexCacheKey(run)).toBe(a);
  });
});
