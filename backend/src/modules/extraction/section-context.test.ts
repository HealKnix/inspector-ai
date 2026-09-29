import { describe, expect, it } from "vitest";
import {
  readyContext,
  resolvedSheet,
  secArtifact,
  secPage,
  secRevision,
  secSnapshot,
  secText,
} from "../../../test/helpers/section-fixture.js";
import type { ParseArtifactData } from "../parsing/parsing-contract.js";
import { buildSectionContexts, sourceStream } from "./section-context.js";

// Synthetic fixtures only; no real documents are used in unit tests.

const rep = (id: string, sha: string) => ({
  file_id: `f-${id}`,
  artifact_id: `art-${id}`,
  artifact_sha256: `sha-${id}`,
  source_sha256: sha,
});

function artifact(sha: string, texts: string[]): ParseArtifactData {
  return secArtifact(
    sha,
    texts.map((text, i) => secPage(i + 1, [secText(`b${i}`, text)])),
  );
}

function snapshot(opts: {
  contextOverrides?: Parameters<typeof readyContext>[3];
  reorder?: boolean;
}) {
  const reps = [rep("one", "a".repeat(64)), rep("two", "b".repeat(64))];
  const ordered = opts.reorder ? [...reps].reverse() : reps;
  return secSnapshot({
    documents: [
      {
        document_id: "pd",
        revisions: [secRevision("pd-r1", "PD", ordered)],
      },
      {
        document_id: "rd",
        revisions: [
          secRevision("rd-r0", "RD", [rep("old", "c".repeat(64))]),
          secRevision("rd-r1", "RD", [rep("new", "d".repeat(64))]),
        ],
      },
      {
        document_id: "id",
        revisions: [secRevision("id-r1", "ID", [rep("id", "e".repeat(64))])],
      },
    ],
    contexts: [
      readyContext(
        "ctx",
        { document_id: "pd", revision_id: "pd-r1" },
        { document_id: "rd", revision_id: "rd-r1" },
        opts.contextOverrides,
      ),
    ],
  });
}

const artifacts = new Map<string, ParseArtifactData>([
  ["art-one", artifact("a".repeat(64), ["Раздел 1", "Текст первый"])],
  ["art-two", artifact("b".repeat(64), ["Раздел 2", "Текст второй"])],
  ["art-old", artifact("c".repeat(64), ["Старый лист"])],
  ["art-new", artifact("d".repeat(64), ["Новый лист"])],
  ["art-id", artifact("e".repeat(64), ["Акт"])],
]);
const artifactFor = (id: string) => artifacts.get(id) ?? null;

describe("buildSectionContexts", () => {
  it("resolves READY contexts only and binds stages from owning revisions", () => {
    const snap = snapshot({});
    snap.contexts.push(
      readyContext(
        "draft",
        null,
        { document_id: "id", revision_id: "id-r1" },
        {
          status: "CLARIFICATION_REQUIRED",
        },
      ),
    );
    const { plans, skipped } = buildSectionContexts(snap, artifactFor);
    expect(skipped).toEqual([
      { context_id: "draft", reason: "context_not_ready" },
    ]);
    expect(plans).toHaveLength(1);
    const plan = plans[0]!;
    const refs = plan.sources.map((s) => s.info.source_ref).sort();
    expect(refs).toEqual(["actual:0", "reference:0", "reference:1"]);
    expect(
      plan.sources.find((s) => s.info.source_ref === "reference:0")!.info
        .document_stage,
    ).toBe("PD");
    expect(
      plan.sources.find((s) => s.info.source_ref === "actual:0")!.info
        .document_stage,
    ).toBe("RD");
    expect(plan.blockers).toEqual([]);
  });

  it("assigns stable source_refs independent of representation order", () => {
    const a = buildSectionContexts(snapshot({}), artifactFor)
      .plans[0]!.sources.map(
        (s) => `${s.info.source_ref}=${s.info.artifact_sha256}`,
      )
      .sort();
    const b = buildSectionContexts(snapshot({ reorder: true }), artifactFor)
      .plans[0]!.sources.map(
        (s) => `${s.info.source_ref}=${s.info.artifact_sha256}`,
      )
      .sort();
    expect(a).toEqual(b);
  });

  it("keeps the physical predecessor identity on inherited selected sheets", () => {
    // actual selection: sheet "1" physically belongs to rd-r0/art-old even
    // though the effective comparison revision is rd-r1.
    const sheet = resolvedSheet({
      label: "1",
      page_number: 1,
      document_id: "rd",
      revision_id: "rd-r0",
      file_id: "f-old",
      artifact_id: "art-old",
      artifact_sha256: "sha-old",
      source_sha256: "c".repeat(64),
    });
    const snap = snapshot({
      contextOverrides: {
        sheet_selection: {
          reference: null,
          actual: { selection_hash: "sel-1", sheets: [sheet], chain: [] },
        },
      },
    });
    const plan = buildSectionContexts(snap, artifactFor).plans[0]!;
    const source = plan.sources.find((s) => s.info.role === "actual")!;
    expect(source.info.document_id).toBe("rd");
    expect(source.info.revision_id).toBe("rd-r0");
    expect(source.info.file_id).toBe("f-old");
    expect(source.info.document_stage).toBe("RD");
    // The effective pairing stays on the context, not on the source.
    expect(plan.context.actual.revision_id).toBe("rd-r1");
    expect(source.stream.map((i) => i.block.raw_text)).toEqual(["Старый лист"]);
  });

  it("blocks a source whose selected sheets disagree on physical owner", () => {
    const mixed = [
      resolvedSheet({
        label: "1",
        page_number: 1,
        document_id: "rd",
        revision_id: "rd-r0",
        file_id: "f-old",
        artifact_id: "art-old",
        artifact_sha256: "sha-old",
        source_sha256: "c".repeat(64),
      }),
      resolvedSheet({
        label: "2",
        page_number: 1,
        document_id: "rd",
        revision_id: "rd-r1", // different physical owner for same artifact
        file_id: "f-new",
        artifact_id: "art-old",
        artifact_sha256: "sha-old",
        source_sha256: "c".repeat(64),
      }),
    ];
    const snap = snapshot({
      contextOverrides: {
        sheet_selection: {
          reference: null,
          actual: {
            selection_hash: "sel-2",
            sheets: mixed,
            chain: [],
          },
        },
      },
    });
    const plan = buildSectionContexts(snap, artifactFor).plans[0]!;
    expect(plan.sources.some((s) => s.info.role === "actual")).toBe(false);
    expect(plan.blockers).toContain("section_selection_mismatch:actual");
  });

  it("flags sheet-bearing revisions without resolved selections", () => {
    const snap = snapshot({});
    snap.documents[1]!.revisions[1]!.sheet_replacement = {
      predecessor_revision_id: "rd-r0",
      replaced_labels: ["1"],
      basis: "x",
    };
    const plan = buildSectionContexts(snap, artifactFor).plans[0]!;
    expect(plan.sources.some((s) => s.info.role === "actual")).toBe(false);
    expect(plan.blockers).toContain("sheet_selection_unresolved:actual");
  });
});

describe("sourceStream", () => {
  it("uses analysisBlocks only — ambiguous blocks never enter the stream", () => {
    const ambiguous = secText("amb", "двусмысленный блок");
    ambiguous.include_in_main = false;
    ambiguous.provenance = {
      schema_version: 1,
      status: "ambiguous",
      method: "hybrid",
      fragments: [
        {
          source: "native",
          raw_text: "двусмысленный блак",
          bbox: [...ambiguous.bbox],
          native_valid: true,
          role: "alternative",
        },
        {
          source: "ocr",
          raw_text: "двусмысленный блок",
          bbox: [...ambiguous.bbox],
          native_valid: null,
          role: "alternative",
        },
      ],
      reasons: ["NATIVE_OCR_TEXT_CONFLICT"],
    };
    const data = secArtifact("s".repeat(64), [
      secPage(1, [secText("ok", "нормальный"), ambiguous]),
    ]);
    const stream = sourceStream(data);
    expect(stream.map((i) => i.block.id)).toEqual(["ok"]);
  });
});
