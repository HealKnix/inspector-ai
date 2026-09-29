import { describe, expect, it } from "vitest";
import {
  readyContext,
  secArtifact,
  secPage,
  secRevision,
  secSnapshot,
  secText,
} from "../../../test/helpers/section-fixture.js";
import type { ComparisonContext } from "../identification/identification-contract.js";
import type { ParseArtifactData } from "../parsing/parsing-contract.js";
import type { SectionAnalysisConfig } from "./section-config.js";
import type { SectionMatrixRow } from "./section-contract.js";
import type {
  SectionEngineInput,
  SectionIndexCacheEntry,
  SectionLlm,
} from "./section-engine.js";
import {
  runSectionAnalysis,
  validateSectionIndexCacheEntry,
} from "./section-engine.js";
import { callSectionLlm, sectionRequestBytes } from "./section-llm.js";

// Synthetic fixtures only; the provider is a scripted fake, never real HTTP.

const REF_SHA = "a".repeat(64);
const ACT_SHA = "b".repeat(64);

const rep = (id: string, sha: string) => ({
  file_id: `f-${id}`,
  artifact_id: `art-${id}`,
  artifact_sha256: `sha-${id}`,
  source_sha256: sha,
});

function refArtifact(pages: ParseArtifactData["pages"] = []) {
  return secArtifact(
    REF_SHA,
    pages.length
      ? pages
      : [
          secPage(1, [
            secText("rh", "Раздел 1"),
            secText("rb", "Толщина стены 200 мм по проекту"),
            secText("rh2", "Раздел 2"),
            secText("rb2", "Проектный текст второго раздела"),
          ]),
        ],
  );
}

function actArtifact(pages: ParseArtifactData["pages"] = []) {
  return secArtifact(
    ACT_SHA,
    pages.length
      ? pages
      : [
          secPage(1, [
            secText("ah", "Раздел 1"),
            secText("ab", "Толщина стены 200 мм исполнительно"),
            secText("ah2", "Раздел 2"),
            secText("ab2", "Фактический текст второго раздела"),
          ]),
        ],
  );
}

function snapshot(contexts: ComparisonContext[]) {
  return secSnapshot({
    documents: [
      {
        document_id: "refdoc",
        revisions: [secRevision("refrev", "RD", [rep("ref", REF_SHA)])],
      },
      {
        document_id: "actdoc",
        revisions: [secRevision("actrev", "ID", [rep("act", ACT_SHA)])],
      },
    ],
    contexts,
  });
}

const pair = () => [
  readyContext(
    "ctx1",
    { document_id: "refdoc", revision_id: "refrev" },
    { document_id: "actdoc", revision_id: "actrev" },
  ),
];

function row(code: string): SectionMatrixRow {
  return {
    parameter_code: code,
    name: `Параметр ${code}`,
    unit: "мм",
    source_pd: null,
    source_rd: "РД раздел",
    source_id: null,
    trigger: "всегда",
  };
}

function config(
  over: Partial<SectionAnalysisConfig> = {},
): SectionAnalysisConfig {
  return {
    enabled: true,
    baseUrl: "https://openrouter.ai/api/v1",
    model: "qwen/qwen3.8-27b",
    apiKey: "",
    requireParameters: true,
    timeoutMs: 60_000,
    maxRequestBytes: 262_144,
    maxResponseBytes: 131_072,
    maxCandidateBytes: 262_144,
    maxChunkBytes: 98_304,
    maxBlockCharacters: 4000,
    maxParametersPerRequest: 8,
    maxCalls: 32,
    maxExpansionCandidates: 8,
    ...over,
  };
}

interface CallLog {
  kind: string;
  payload: Record<string, unknown>;
}

/** Single shape-aware dispatch — responses never depend on call order. */
function fakeLlm(dispatch: (call: CallLog) => unknown): {
  llm: SectionLlm;
  calls: CallLog[];
} {
  const calls: CallLog[] = [];
  return {
    calls,
    llm: {
      call(kind, payload) {
        const call: CallLog = {
          kind,
          payload: payload as Record<string, unknown>,
        };
        calls.push(call);
        return Promise.resolve(dispatch(call));
      },
    },
  };
}

/**
 * The REAL strict provider adapter over a mocked fetch — every engine call
 * is serialized, byte-checked and parsed by callSectionLlm itself. No
 * network: the fake returns a well-formed envelope for the payload it was
 * handed.
 */
function wireLlm(
  cfg: SectionAnalysisConfig,
  dispatch: (call: CallLog) => unknown,
): { llm: SectionLlm; calls: CallLog[] } {
  const calls: CallLog[] = [];
  const fetchImpl = ((_input: unknown, init?: { body?: unknown }) => {
    const raw = typeof init?.body === "string" ? init.body : "";
    const envelope = JSON.parse(raw) as {
      response_format: { json_schema: { name: string } };
      messages: { role: string; content: string }[];
    };
    const kind =
      envelope.response_format.json_schema.name === "section_discovery"
        ? "discovery"
        : "analysis";
    const payload = JSON.parse(envelope.messages[1]!.content) as Record<
      string,
      unknown
    >;
    calls.push({ kind, payload });
    return Promise.resolve(
      new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: JSON.stringify(dispatch({ kind, payload })),
                tool_calls: null,
                refusal: null,
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  }) as typeof fetch;
  return {
    calls,
    llm: {
      call: (kind, payload) =>
        callSectionLlm(cfg, kind, payload, { fetchImpl }),
    },
  };
}

const discovery = (sections: unknown[], expand: unknown[] = []) => ({
  sections,
  expand,
  missing_context: [],
});

const refSection = (end = "rb", codes = ["P1"]) => ({
  source_ref: "reference:0",
  title: "Раздел 1",
  start_block_id: "rh",
  end_block_id: end,
  parameter_codes: codes,
});
const actSection = (end = "ab", codes = ["P1"]) => ({
  source_ref: "actual:0",
  title: "Раздел 1",
  start_block_id: "ah",
  end_block_id: end,
  parameter_codes: codes,
});

/** Grounded item citing the section heading blocks of both roles. */
const grounded = (
  code: string,
  refBlock = "rh",
  actBlock = "ah",
  extra: Record<string, unknown> = {},
) => ({
  parameter_code: code,
  assessment: "proposed_agreement",
  fact: "Параметр совпадает",
  evidence: [
    { source_ref: "reference:0", block_id: refBlock, quote: "Раздел" },
    { source_ref: "actual:0", block_id: actBlock, quote: "Раздел" },
  ],
  missing_context: [],
  question_for_inspector: null,
  ...extra,
});

const insuff = (code: string, missing = "часть раздела не подтверждена") => ({
  parameter_code: code,
  assessment: "insufficient_context",
  fact: null,
  evidence: [],
  missing_context: [missing],
  question_for_inspector: null,
});

function input(over: Partial<SectionEngineInput> = {}): SectionEngineInput {
  return {
    snapshot: snapshot(pair()),
    artifactFor: (id) =>
      id === "art-ref"
        ? refArtifact()
        : id === "art-act"
          ? actArtifact()
          : null,
    rows: [row("P1")],
    matrix_identity: "mx-1",
    config: config(),
    llm: fakeLlm(() => ({})).llm,
    ...over,
  };
}

const twoSections = () => [refSection(), actSection()];

describe("runSectionAnalysis", () => {
  it("runs discovery, materialization and a grounded both-role verdict", async () => {
    const { llm, calls } = fakeLlm((call) =>
      call.kind === "discovery"
        ? discovery(twoSections())
        : { results: [grounded("P1")] },
    );
    const out = await runSectionAnalysis(input({ llm }));
    expect(calls.map((c) => c.kind)).toEqual(["discovery", "analysis"]);
    const ctx = out.contexts[0]!;
    expect(ctx.coverage).toEqual({ complete: true, missing: [] });
    expect(ctx.sections).toHaveLength(2);
    // D7: published bounds carry the real endpoint pages, server-derived.
    expect(ctx.sections[0]).toMatchObject({
      source_ref: "reference:0",
      start_page_number: 1,
      end_page_number: 1,
    });
    const p = ctx.parameters[0]!;
    expect(p.assessment).toBe("proposed_agreement");
    expect(p.evidence).toHaveLength(2);
    const ref = p.evidence.find((e) => e.role === "reference")!;
    expect(ref).toMatchObject({
      source_ref: "reference:0",
      document_id: "refdoc",
      revision_id: "refrev",
      file_id: "f-ref",
      artifact_id: "art-ref",
      page_number: 1,
      quote: "Раздел",
    });
    expect(ref.bbox).toHaveLength(4);
    // Server-resolved stages travel on the wire sources.
    expect(
      ctx.sources.find((s) => s.role === "reference")!.document_stage,
    ).toBe("RD");
    expect(ctx.sources.find((s) => s.role === "actual")!.document_stage).toBe(
      "ID",
    );
    // The analysis part also carries stage — inspect the wire payload.
    const parts = calls[1]!.payload.parts as Record<string, unknown>[];
    expect(parts.map((part) => part.stage).sort()).toEqual(["ID", "RD"]);
    expect(out.calls_used).toBe(2);
    expect(out.failures).toEqual([]);
    expect(out.analysis_basis).toMatchObject({
      matrix_identity: "mx-1",
      model: "qwen/qwen3.8-27b",
    });
  });

  it("derives real page bounds for multi-page sections", async () => {
    const twoPage = refArtifact([
      secPage(1, [secText("rh", "Раздел 1"), secText("rb", "начало")]),
      secPage(2, [secText("r2", "продолжение"), secText("r3", "конец")]),
    ]);
    const out = await runSectionAnalysis(
      input({
        artifactFor: (id) => (id === "art-ref" ? twoPage : actArtifact()),
        llm: fakeLlm((call) =>
          call.kind === "discovery"
            ? discovery([refSection("r3"), actSection()])
            : { results: [insuff("P1")] },
        ).llm,
      }),
    );
    const ref = out.contexts[0]!.sections.find(
      (s) => s.source_ref === "reference:0",
    )!;
    expect(ref.start_page_number).toBe(1);
    expect(ref.end_page_number).toBe(2);
  });

  it("downgrades a single-role grounded response to a failed request", async () => {
    const { llm } = fakeLlm((call) =>
      call.kind === "discovery"
        ? discovery(twoSections())
        : {
            results: [
              grounded("P1", "rh", "ah", {
                evidence: [
                  {
                    source_ref: "reference:0",
                    block_id: "rh",
                    quote: "Раздел",
                  },
                ],
              }),
            ],
          },
    );
    const out = await runSectionAnalysis(input({ llm }));
    const ctx = out.contexts[0]!;
    expect(ctx.parameters[0]!.assessment).toBe("insufficient_context");
    expect(ctx.coverage.complete).toBe(false);
    expect(out.failures[0]).toMatchObject({
      stage: "analysis",
      code: "section_analysis_one_sided_evidence",
    });
    expect(ctx.coverage.missing).toEqual(
      expect.arrayContaining([
        expect.stringContaining("chunk_unprocessed"),
        expect.stringContaining("analysis_failed:P1"),
      ]),
    );
  });

  it("keeps model-declared missing_context effective on grounded rows", async () => {
    const { llm } = fakeLlm((call) =>
      call.kind === "discovery"
        ? discovery(twoSections())
        : {
            results: [
              grounded("P1", "rh", "ah", { missing_context: ["неясность"] }),
            ],
          },
    );
    const out = await runSectionAnalysis(input({ llm }));
    const p = out.contexts[0]!.parameters[0]!;
    expect(p.assessment).toBe("insufficient_context");
    expect(p.missing_context).toContain("неясность");
  });

  it("marks an unreadable middle page as missing coverage", async () => {
    const actual = actArtifact([
      secPage(1, [secText("ah", "Раздел 1"), secText("ab", "лист 1")]),
      secPage(2, [], { quality: "ABSTAIN", reasons: ["no text"] }),
      secPage(3, [secText("a3", "конец")]),
    ]);
    const out = await runSectionAnalysis(
      input({
        artifactFor: (id) => (id === "art-ref" ? refArtifact() : actual),
        llm: fakeLlm((call) =>
          call.kind === "discovery"
            ? discovery([refSection(), actSection("a3")])
            : { results: [grounded("P1", "rh", "a3", { quote: "" })] },
        ).llm,
      }),
    );
    const ctx = out.contexts[0]!;
    expect(ctx.coverage.complete).toBe(false);
    expect(
      ctx.coverage.missing.some((m) => m.startsWith("page_unreadable:")),
    ).toBe(true);
    expect(ctx.parameters[0]!.assessment).toBe("insufficient_context");
  });
});

describe("discovery cache", () => {
  it("replays cached sections and their uncertainty without a discovery call", async () => {
    const entry: SectionIndexCacheEntry = {
      sections: [
        { section_id: "s0", ...refSection() },
        { section_id: "s1", ...actSection() },
      ],
      missing_context: ["discovery_missing:cached_gap"],
    };
    const { llm, calls } = fakeLlm(() => ({ results: [insuff("P1")] }));
    const out = await runSectionAnalysis(
      input({
        llm,
        cache: {
          get: () => Promise.resolve(entry),
          set: () => Promise.resolve(),
        },
      }),
    );
    expect(calls.every((c) => c.kind !== "discovery")).toBe(true);
    const ctx = out.contexts[0]!;
    expect(ctx.sections).toHaveLength(2);
    expect(ctx.coverage.missing).toContain("discovery_missing:cached_gap");
    expect(ctx.coverage.complete).toBe(false);
  });

  it("drops stale cached boundaries as explicit missing coverage", async () => {
    const entry: SectionIndexCacheEntry = {
      sections: [
        { section_id: "s0", ...refSection(), start_block_id: "gone" },
        { section_id: "s1", ...actSection() },
      ],
      missing_context: [],
    };
    const out = await runSectionAnalysis(
      input({
        llm: fakeLlm(() => ({ results: [insuff("P1")] })).llm,
        cache: {
          get: () => Promise.resolve(entry),
          set: () => Promise.resolve(),
        },
      }),
    );
    const ctx = out.contexts[0]!;
    // The dropped boundary was scoped to its own parameter code.
    expect(ctx.coverage.missing).toContain("cache_revalidation_dropped");
    expect(ctx.parameters[0]!.assessment).toBe("insufficient_context");
  });

  it("treats an empty cached boundary set as unanswered, never complete", async () => {
    const out = await runSectionAnalysis(
      input({
        llm: fakeLlm(() => ({})).llm,
        cache: {
          get: () => Promise.resolve({ sections: [], missing_context: [] }),
          set: () => Promise.resolve(),
        },
      }),
    );
    const ctx = out.contexts[0]!;
    expect(ctx.sections).toEqual([]);
    expect(ctx.coverage.complete).toBe(false);
    expect(ctx.coverage.missing).toContain("row_unanswered:P1");
    expect(ctx.parameters[0]!.assessment).toBe("insufficient_context");
  });

  it("rejects malformed persisted entries and rediscovers", async () => {
    const { llm, calls } = fakeLlm((call) =>
      call.kind === "discovery"
        ? discovery(twoSections())
        : { results: [insuff("P1")] },
    );
    const out = await runSectionAnalysis(
      input({
        llm,
        cache: {
          get: () =>
            Promise.resolve({ sections: "nope", missing_context: [] } as never),
          set: () => Promise.resolve(),
        },
      }),
    );
    expect(out.contexts[0]!.coverage.missing).toContain("cache_entry_invalid");
    expect(calls[0]!.kind).toBe("discovery");
  });

  it("persists discovery uncertainty with the cached sections", async () => {
    let stored: SectionIndexCacheEntry | undefined;
    const out = await runSectionAnalysis(
      input({
        llm: fakeLlm((call) =>
          call.kind === "discovery"
            ? {
                ...discovery(twoSections()),
                missing_context: ["нет титульного листа"],
              }
            : { results: [insuff("P1")] },
        ).llm,
        cache: {
          get: () => Promise.resolve(undefined),
          set: (_key, entry) => {
            stored = entry;
            return Promise.resolve();
          },
        },
      }),
    );
    expect(stored!.sections).toHaveLength(2);
    expect(stored!.missing_context).toEqual([
      "discovery_missing:нет титульного листа",
    ]);
    expect(out.contexts[0]!.coverage.missing).toContain(
      "discovery_missing:нет титульного листа",
    );
  });
});

describe("validateSectionIndexCacheEntry", () => {
  const base: SectionIndexCacheEntry = {
    sections: [
      {
        section_id: "s0",
        source_ref: "reference:0",
        title: "Раздел",
        start_block_id: "a",
        end_block_id: "b",
        parameter_codes: ["P1"],
      },
    ],
    missing_context: ["x"],
  };
  it("accepts a minimal entry and returns a normalized copy", () => {
    expect(validateSectionIndexCacheEntry(base)).toEqual(base);
  });
  it("rejects malformed shapes, fields and duplicates", () => {
    expect(validateSectionIndexCacheEntry(null)).toBeUndefined();
    expect(validateSectionIndexCacheEntry({ sections: {} })).toBeUndefined();
    const missingKey = { ...base.sections[0] } as Record<string, unknown>;
    delete missingKey.title;
    expect(
      validateSectionIndexCacheEntry({ ...base, sections: [missingKey] }),
    ).toBeUndefined();
    expect(
      validateSectionIndexCacheEntry({
        ...base,
        sections: [{ ...base.sections[0]!, source_ref: "bogus" }],
      }),
    ).toBeUndefined();
    expect(
      validateSectionIndexCacheEntry({
        ...base,
        sections: [base.sections[0]!, { ...base.sections[0]! }],
      }),
    ).toBeUndefined();
    // Same anchor under a different section_id is still contradictory.
    expect(
      validateSectionIndexCacheEntry({
        ...base,
        sections: [
          base.sections[0]!,
          { ...base.sections[0]!, section_id: "s1" },
        ],
      }),
    ).toBeUndefined();
    expect(
      validateSectionIndexCacheEntry({
        ...base,
        sections: [{ ...base.sections[0]!, parameter_codes: ["x".repeat(65)] }],
      }),
    ).toBeUndefined();
    expect(
      validateSectionIndexCacheEntry({ ...base, missing_context: [""] }),
    ).toBeUndefined();
  });
});

describe("discovery passes", () => {
  it("replaces a first-pass boundary with the corrected second-pass one", async () => {
    const { llm, calls } = fakeLlm((call) => {
      if (call.kind !== "discovery") return { results: [insuff("P1")] };
      // Second pass carries the expansion requests; first pass carries none.
      return (call.payload.expansions as unknown[]).length
        ? discovery([refSection("rb2")])
        : discovery(twoSections(), [
            { source_ref: "reference:0", candidate_id: "reference:0:c0" },
          ]);
    });
    const out = await runSectionAnalysis(input({ llm }));
    expect(calls[0]!.kind).toBe("discovery");
    expect(calls[1]!.kind).toBe("discovery");
    expect((calls[1]!.payload.expansions as unknown[]).length).toBeGreaterThan(
      0,
    );
    const sections = out.contexts[0]!.sections;
    expect(sections).toHaveLength(2);
    expect(
      sections.find((s) => s.source_ref === "reference:0")!.end_block_id,
    ).toBe("rb2");
  });

  it("reports an expansion request that cannot be served", async () => {
    const out = await runSectionAnalysis(
      input({
        config: config({ maxExpansionCandidates: 0 }),
        llm: fakeLlm((call) =>
          call.kind === "discovery"
            ? discovery(twoSections(), [
                { source_ref: "reference:0", candidate_id: "reference:0:c0" },
              ])
            : { results: [insuff("P1")] },
        ).llm,
      }),
    );
    expect(out.contexts[0]!.coverage.missing).toContain("expansion_unserved:1");
  });
});

describe("analysis reconciliation", () => {
  // 3200 Cyrillic chars ≈ 6.4 KB serialized — a section part is ~7 KB on the
  // wire, so a ref+act pair fits 20480 but a third part does not: every
  // analysis request carries exactly one pair.
  const big = (text: string) => `${text} ${"к".repeat(3200)}`;
  const multiArtifact = (role: "ref" | "act") =>
    secArtifact(role === "ref" ? REF_SHA : ACT_SHA, [
      secPage(1, [
        secText(`${role}h`, "Раздел 1"),
        secText(`${role}b1`, big("текст первый")),
        secText(`${role}h2`, "Раздел 2"),
        secText(`${role}b2`, big("текст второй")),
      ]),
    ]);
  const multiInput = (
    over: Partial<SectionEngineInput> = {},
  ): SectionEngineInput => ({
    ...input(),
    config: config({ maxRequestBytes: 20480, ...over.config }),
    artifactFor: (id) =>
      id === "art-ref" ? multiArtifact("ref") : multiArtifact("act"),
    ...over,
    llm: over.llm!,
  });
  const multiSections = (codes = ["P1"]) => [
    {
      source_ref: "reference:0",
      title: "Раздел 1",
      start_block_id: "refh",
      end_block_id: "refb1",
      parameter_codes: codes,
    },
    {
      source_ref: "reference:0",
      title: "Раздел 2",
      start_block_id: "refh2",
      end_block_id: "refb2",
      parameter_codes: codes,
    },
    {
      source_ref: "actual:0",
      title: "Раздел 1",
      start_block_id: "acth",
      end_block_id: "actb1",
      parameter_codes: codes,
    },
    {
      source_ref: "actual:0",
      title: "Раздел 2",
      start_block_id: "acth2",
      end_block_id: "actb2",
      parameter_codes: codes,
    },
  ];
  // Sections are numbered in discovery order: sec0/sec1 reference, sec2/sec3 actual.
  const perRequest = (call: CallLog, cite: "head" | "body") => {
    const parts = call.payload.parts as {
      source_ref: string;
      section_id: string;
    }[];
    const ref = parts.find((p) => p.source_ref.startsWith("reference"))!;
    const act = parts.find((p) => p.source_ref.startsWith("actual"))!;
    const refBlock =
      cite === "body"
        ? ref.section_id === "sec0"
          ? "refb1"
          : "refb2"
        : ref.section_id === "sec0"
          ? "refh"
          : "refh2";
    const actBlock =
      cite === "body"
        ? act.section_id === "sec2"
          ? "actb1"
          : "actb2"
        : act.section_id === "sec2"
          ? "acth"
          : "acth2";
    return {
      results: [
        {
          parameter_code: "P1",
          assessment: "proposed_agreement",
          fact: "ок",
          evidence: [
            {
              source_ref: ref.source_ref,
              block_id: refBlock,
              quote: cite === "body" ? "текст" : "Раздел",
            },
            {
              source_ref: act.source_ref,
              block_id: actBlock,
              quote: cite === "body" ? "текст" : "Раздел",
            },
          ],
          missing_context: [],
          question_for_inspector: null,
        },
      ],
    };
  };

  /** One cited block of each role, picked by role — not by list position. */
  const roleCites = (call: CallLog) => {
    const cited = call.payload.cited_blocks as {
      source_ref: string;
      block_id: string;
    }[];
    return [
      cited.find((b) => b.source_ref.startsWith("reference"))!,
      cited.find((b) => b.source_ref.startsWith("actual"))!,
    ].map((b) => ({
      source_ref: b.source_ref,
      block_id: b.block_id,
      quote: "Раздел",
    }));
  };

  it("runs a real bounded LLM reconciliation across multiple observations", async () => {
    const { llm, calls } = fakeLlm((call) => {
      if (call.kind === "discovery") return discovery(multiSections());
      if (Array.isArray(call.payload.observations)) {
        // Reconciliation: cite blocks from the submitted cited_blocks only.
        return {
          results: [
            {
              parameter_code: "P1",
              assessment: "potential_difference",
              fact: "Итог после сверки частей",
              evidence: roleCites(call),
              missing_context: [],
              question_for_inspector: "Проверить разницу",
            },
          ],
        };
      }
      return perRequest(call, "head");
    });
    const out = await runSectionAnalysis(multiInput({ llm }));
    const analysisCalls = calls.filter((c) => c.kind === "analysis");
    // Two pairable requests + one reconciliation call.
    expect(analysisCalls.length).toBe(3);
    const reconcile = analysisCalls.find((c) =>
      Array.isArray(c.payload.observations),
    )!.payload;
    expect(Array.isArray(reconcile.observations)).toBe(true);
    const observations = reconcile.observations as {
      parameter_code: string;
      responses: unknown[];
    }[];
    expect(observations[0]!.responses).toHaveLength(2);
    expect((reconcile.cited_blocks as unknown[]).length).toBeGreaterThan(0);
    const p = out.contexts[0]!.parameters[0]!;
    expect(p.assessment).toBe("potential_difference");
    expect(p.fact).toBe("Итог после сверки частей");
    expect(out.contexts[0]!.coverage.complete).toBe(true);
  });

  it("emits reconciliation_unsupported instead of truncating into complete", async () => {
    // Observations cite the large body blocks: the reconciliation payload
    // can never fit the request budget.
    const { llm } = fakeLlm((call) =>
      call.kind === "discovery"
        ? discovery(multiSections())
        : perRequest(call, "body"),
    );
    const out = await runSectionAnalysis(multiInput({ llm }));
    const ctx = out.contexts[0]!;
    expect(ctx.coverage.missing).toContain("reconciliation_unsupported:1");
    expect(ctx.coverage.complete).toBe(false);
    expect(ctx.parameters[0]!.assessment).toBe("insufficient_context");
  });

  it("emits reconciliation_unserved when the call budget is exhausted", async () => {
    const { llm } = fakeLlm((call) =>
      call.kind === "discovery"
        ? discovery(multiSections())
        : perRequest(call, "head"),
    );
    const out = await runSectionAnalysis(
      multiInput({
        llm,
        config: config({ maxRequestBytes: 20480, maxCalls: 3 }),
      }),
    );
    expect(out.contexts[0]!.coverage.missing).toContain(
      "reconciliation_unserved:1",
    );
    expect(out.contexts[0]!.parameters[0]!.assessment).toBe(
      "insufficient_context",
    );
  });

  it("batches reconciliation under the configured row budget", async () => {
    const codes = ["P1", "P2", "P3"];
    const { llm, calls } = fakeLlm((call) => {
      if (call.kind === "discovery") return discovery(multiSections(codes));
      const params = call.payload.parameters as { parameter_code: string }[];
      if (Array.isArray(call.payload.observations)) {
        return {
          results: params.map((p) => ({
            parameter_code: p.parameter_code,
            assessment: "proposed_agreement",
            fact: "сверено",
            evidence: roleCites(call),
            missing_context: [],
            question_for_inspector: null,
          })),
        };
      }
      // Plain analysis request: answer its whole batch grounded.
      const parts = call.payload.parts as {
        source_ref: string;
        section_id: string;
      }[];
      const refB = parts.some((p) => p.section_id === "sec1")
        ? "refh2"
        : "refh";
      const actB = parts.some((p) => p.section_id === "sec3")
        ? "acth2"
        : "acth";
      return {
        results: params.map((p) => grounded(p.parameter_code, refB, actB)),
      };
    });
    const out = await runSectionAnalysis(
      multiInput({
        llm,
        rows: codes.map(row),
        config: config({ maxRequestBytes: 20480, maxParametersPerRequest: 2 }),
      }),
    );
    const reconcileCalls = calls.filter(
      (c) => c.kind === "analysis" && Array.isArray(c.payload.observations),
    );
    expect(reconcileCalls.length).toBe(2); // [P1,P2] then [P3]
    expect(out.contexts[0]!.parameters.map((p) => p.assessment)).toEqual([
      "proposed_agreement",
      "proposed_agreement",
      "proposed_agreement",
    ]);
  });

  it("sends every packed request through the real provider adapter", async () => {
    // A paired request is ~17-18 KB on the wire: inside 20480, while a
    // third part would not be — packing must charge the real envelope.
    const cfg = config({ maxRequestBytes: 20480 });
    const { llm, calls } = wireLlm(cfg, (call) => {
      if (call.kind === "discovery") return discovery(multiSections());
      if (Array.isArray(call.payload.observations))
        return {
          results: [
            {
              parameter_code: "P1",
              assessment: "proposed_agreement",
              fact: "сверено по частям",
              evidence: roleCites(call),
              missing_context: [],
              question_for_inspector: null,
            },
          ],
        };
      return perRequest(call, "head");
    });
    const out = await runSectionAnalysis(multiInput({ llm, config: cfg }));
    // Discovery, two paired requests and the reconciliation all reached
    // the (mocked) wire — nothing planned exceeded the adapter check.
    expect(calls.map((c) => c.kind)).toEqual([
      "discovery",
      "analysis",
      "analysis",
      "analysis",
    ]);
    expect(out.contexts[0]!.parameters[0]!.assessment).toBe(
      "proposed_agreement",
    );
    expect(out.contexts[0]!.coverage.complete).toBe(true);
  });

  it("reports unpackable chunks when only the wire body does not fit", async () => {
    // Discovery's manifest fits 8 KB; overhead plus even one section part
    // (~10 KB) does not — the adapter must never be asked for it.
    const cfg = config({ maxRequestBytes: 8192 });
    const { llm, calls } = wireLlm(cfg, (call) =>
      call.kind === "discovery" ? discovery(multiSections()) : { results: [] },
    );
    const out = await runSectionAnalysis(multiInput({ llm, config: cfg }));
    expect(calls.map((c) => c.kind)).toEqual(["discovery"]);
    const ctx = out.contexts[0]!;
    expect(
      ctx.coverage.missing.some((m) => m.startsWith("chunk_unprocessed:")),
    ).toBe(true);
    expect(ctx.parameters[0]!.assessment).toBe("insufficient_context");
  });

  it("counts the part separator at the exact wire boundary", async () => {
    // Probe once with the pair budget to learn the real wire size of a
    // paired request, then rerun one byte below it: a second part adds its
    // comma, so only single-part requests may be sent.
    const probeCfg = config({ maxRequestBytes: 20480 });
    const { llm: probeLlm, calls: probeCalls } = wireLlm(probeCfg, (call) =>
      call.kind === "discovery"
        ? discovery(multiSections())
        : perRequest(call, "head"),
    );
    await runSectionAnalysis(multiInput({ llm: probeLlm, config: probeCfg }));
    const paired = probeCalls.find(
      (c) =>
        c.kind === "analysis" && (c.payload.parts as unknown[]).length === 2,
    )!;
    const pairWire = sectionRequestBytes(probeCfg, "analysis", paired.payload);
    // One byte below the paired wire: the separator alone tips the pair
    // over the budget, so only single-part requests are legal.
    const cfg = config({ maxRequestBytes: pairWire - 1 });
    const { llm, calls } = wireLlm(cfg, (call) => {
      if (call.kind === "discovery") return discovery(multiSections());
      // Single-part requests carry one role only — no grounded answer is
      // possible; reconciliation of those observations stays insufficient.
      const params = call.payload.parameters as {
        parameter_code: string;
      }[];
      return { results: params.map((p) => insuff(p.parameter_code)) };
    });
    const out = await runSectionAnalysis(multiInput({ llm, config: cfg }));
    const analysisCalls = calls.filter((c) => c.kind === "analysis");
    // The separator byte is charged in the fit check: the reference+actual
    // pair would exceed the budget by exactly one byte, and under the real
    // adapter an oversized plan would throw before reaching fetch — so
    // every delivered request provably fit its wire body.
    const partCounts = analysisCalls
      .filter((c) => !Array.isArray(c.payload.observations))
      .map((c) => (c.payload.parts as unknown[]).length);
    expect(partCounts.reduce((a, b) => a + b, 0)).toBe(4);
    const ctx = out.contexts[0]!;
    expect(ctx.coverage.complete).toBe(true);
    expect(out.failures).toEqual([]);
    expect(ctx.parameters[0]!.assessment).toBe("insufficient_context");
  });
});

describe("bounded packing and budgets", () => {
  it("returns unpackable chunks instead of looping when heads cannot fit", async () => {
    const out = await runSectionAnalysis(
      input({
        // Fits a discovery wire body but not the analysis wire overhead:
        // the serialized batch parameters alone exceed the budget.
        config: config({ maxRequestBytes: 16384 }),
        rows: [
          row("P1"),
          row("P2"),
          row("P3"),
          row("P4"),
          row("P5"),
          row("P6"),
          row("P7"),
          row("P8"),
        ].map((r) => ({ ...r, name: "n".repeat(2000) })),
        llm: fakeLlm((call) =>
          call.kind === "discovery"
            ? discovery(twoSections())
            : { results: [] },
        ).llm,
      }),
    );
    const ctx = out.contexts[0]!;
    expect(
      ctx.coverage.missing.some((m) => m.startsWith("chunk_unprocessed:")),
    ).toBe(true);
    expect(
      ctx.parameters.every((p) => p.assessment === "insufficient_context"),
    ).toBe(true);
  });

  it("stops analysis calls when the global call budget is exhausted", async () => {
    const { llm } = fakeLlm((call) =>
      call.kind === "discovery"
        ? discovery(twoSections())
        : { results: [grounded("P1")] },
    );
    const out = await runSectionAnalysis(
      input({ llm, config: config({ maxCalls: 1 }) }),
    );
    const ctx = out.contexts[0]!;
    expect(out.calls_used).toBe(1);
    expect(ctx.coverage.missing).toContain("call_budget_exhausted");
    expect(ctx.parameters[0]!.assessment).toBe("insufficient_context");
  });

  it("covers 65 matrix rows through one shared section per source", async () => {
    const codes = Array.from({ length: 65 }, (_, i) => `P${i}`);
    const { llm } = fakeLlm((call) => {
      if (call.kind === "discovery")
        return discovery(
          twoSections().map((s) => ({ ...s, parameter_codes: codes })),
        );
      const params = call.payload.parameters as { parameter_code: string }[];
      return { results: params.map((p) => grounded(p.parameter_code)) };
    });
    const out = await runSectionAnalysis(
      input({
        llm,
        rows: codes.map(row),
        config: config({ maxParametersPerRequest: 32 }),
      }),
    );
    const ctx = out.contexts[0]!;
    expect(ctx.parameters).toHaveLength(65);
    expect(
      ctx.parameters.every((p) => p.assessment === "proposed_agreement"),
    ).toBe(true);
    expect(ctx.coverage.complete).toBe(true);
    // 1 discovery + ceil(65/32)=3 analysis calls.
    expect(out.calls_used).toBe(4);
  });

  it("reports discovery failure without invented results", async () => {
    const { llm } = fakeLlm(() => {
      throw new Error("boom");
    });
    const out = await runSectionAnalysis(input({ llm }));
    const ctx = out.contexts[0]!;
    expect(ctx.parameters[0]!.assessment).toBe("insufficient_context");
    expect(ctx.coverage.complete).toBe(false);
    expect(out.failures[0]!.stage).toBe("discovery");
  });
});

describe("row-scoped coverage (D3)", () => {
  it("keeps a fully covered row grounded while a neighbour stays unanswered", async () => {
    // Only P1 has discovered sections; P2's absence is its own gap.
    const { llm } = fakeLlm((call) =>
      call.kind === "discovery"
        ? discovery([refSection("rb", ["P1"]), actSection("ab", ["P1"])])
        : { results: [grounded("P1"), insuff("P2")] },
    );
    const out = await runSectionAnalysis(
      input({ llm, rows: [row("P1"), row("P2")] }),
    );
    const ctx = out.contexts[0]!;
    const [p1, p2] = ctx.parameters;
    expect(p1!.assessment).toBe("proposed_agreement");
    expect(p1!.evidence).toHaveLength(2);
    expect(p1!.coverage).toEqual({ complete: true, missing: [] });
    expect(p2!.assessment).toBe("insufficient_context");
    expect(p2!.coverage).toEqual({
      complete: false,
      missing: ["row_unanswered:P2"],
    });
    // The aggregate still reports the missing row honestly.
    expect(ctx.coverage).toEqual({
      complete: false,
      missing: ["row_unanswered:P2"],
    });
  });

  it("scopes a section-level gap to its own parameter, not the whole run", async () => {
    // P2's reference section contains an ambiguous read — P1 is unaffected.
    const ambiguous = {
      ...secText("amb", "неразборчиво"),
      include_in_main: false,
      provenance: {
        schema_version: 1 as const,
        status: "ambiguous" as const,
        method: "hybrid" as const,
        fragments: [
          {
            source: "native" as const,
            raw_text: "неразборчиво?",
            bbox: [0.1, 0.3, 0.9, 0.35] as [number, number, number, number],
            native_valid: true,
            role: "alternative" as const,
          },
        ],
        reasons: ["NATIVE_OCR_TEXT_CONFLICT"],
      },
    };
    const ref = refArtifact([
      secPage(1, [
        secText("rh", "Раздел 1"),
        secText("rb", "текст"),
        secText("rh2", "Раздел 2"),
        ambiguous,
        secText("rb2", "конец"),
      ]),
    ]);
    const { llm } = fakeLlm((call) => {
      if (call.kind === "discovery")
        return discovery([
          refSection("rb", ["P1"]),
          { ...refSection("rb2", ["P2"]), start_block_id: "rh2" },
          // One shared actual section covers both codes — two entries on
          // the same anchor would overwrite each other in discovery.
          actSection("ab", ["P1", "P2"]),
        ]);
      const params = call.payload.parameters as { parameter_code: string }[];
      return {
        results: params.map((p) =>
          grounded(
            p.parameter_code,
            p.parameter_code === "P2" ? "rh2" : "rh",
            "ah",
          ),
        ),
      };
    });
    const out = await runSectionAnalysis(
      input({
        llm,
        rows: [row("P1"), row("P2")],
        artifactFor: (id) => (id === "art-ref" ? ref : actArtifact()),
      }),
    );
    const ctx = out.contexts[0]!;
    const [p1, p2] = ctx.parameters;
    expect(p1!.assessment).toBe("proposed_agreement");
    expect(p1!.coverage).toEqual({ complete: true, missing: [] });
    expect(p2!.assessment).toBe("insufficient_context");
    expect(p2!.coverage!.missing).toEqual(
      expect.arrayContaining([expect.stringContaining("content_filtered:")]),
    );
    expect(ctx.coverage.complete).toBe(false);
    expect(ctx.coverage.missing).toEqual(
      expect.arrayContaining([expect.stringContaining("content_filtered:")]),
    );
  });

  it("shared discovery uncertainty revokes every row conservatively", async () => {
    // Unscoped model-declared boundary uncertainty is shared: a fully
    // processed row still cannot be claimed complete.
    const { llm } = fakeLlm((call) =>
      call.kind === "discovery"
        ? {
            ...discovery(twoSections()),
            missing_context: ["заголовок обрезан"],
          }
        : { results: [grounded("P1")] },
    );
    const out = await runSectionAnalysis(input({ llm }));
    const ctx = out.contexts[0]!;
    expect(ctx.coverage.missing).toContain(
      "discovery_missing:заголовок обрезан",
    );
    const p = ctx.parameters[0]!;
    expect(p.assessment).toBe("insufficient_context");
    expect(p.coverage!.missing).toContain(
      "discovery_missing:заголовок обрезан",
    );
  });

  it("counts omitted discovery candidates as shared partial coverage", async () => {
    // More heading candidates than the manifest budget admits — the note is
    // emitted before discovery runs and stays shared whichever sections the
    // model then finds.
    const manyHeadings = (prefix: string) =>
      secPage(1, [
        secText(`${prefix}h`, "Раздел 1"),
        ...Array.from({ length: 8 }, (_, i) =>
          secText(`${prefix}x${i}`, `Раздел ${i + 2}`),
        ),
        secText(`${prefix}b`, "текст"),
      ]);
    const { llm } = fakeLlm((call) =>
      call.kind === "discovery"
        ? discovery(twoSections())
        : { results: [grounded("P1")] },
    );
    const out = await runSectionAnalysis(
      input({
        llm,
        artifactFor: (id) =>
          id === "art-ref"
            ? refArtifact([manyHeadings("r")])
            : actArtifact([manyHeadings("a")]),
        config: config({ maxCandidateBytes: 1400 }),
      }),
    );
    const ctx = out.contexts[0]!;
    expect(ctx.coverage.missing).toEqual(
      expect.arrayContaining([
        expect.stringContaining("discovery_candidates_omitted:"),
      ]),
    );
    const p = ctx.parameters[0]!;
    expect(p.assessment).toBe("insufficient_context");
    expect(p.coverage!.missing).toEqual(
      expect.arrayContaining([
        expect.stringContaining("discovery_candidates_omitted:"),
      ]),
    );
  });

  it("flags an unresolved table region on a readable section page", async () => {
    const ref = refArtifact([
      secPage(1, [secText("rh", "Раздел 1"), secText("rb", "текст")], {
        regions: [
          {
            id: "grid",
            kind: "table",
            bbox: [0.1, 0.4, 0.9, 0.8],
            raw_class: null,
            raw_score: null,
            method: "table_ocr",
            reasons: [],
            table_status: "unreadable",
          },
        ],
      }),
    ]);
    const out = await runSectionAnalysis(
      input({
        artifactFor: (id) => (id === "art-ref" ? ref : actArtifact()),
        llm: fakeLlm((call) =>
          call.kind === "discovery"
            ? discovery(twoSections())
            : { results: [grounded("P1")] },
        ).llm,
      }),
    );
    const ctx = out.contexts[0]!;
    expect(
      ctx.coverage.missing.some((m) => m.startsWith("region_unresolved:")),
    ).toBe(true);
    expect(ctx.parameters[0]!.assessment).toBe("insufficient_context");
    expect(ctx.parameters[0]!.coverage!.complete).toBe(false);
  });
});
