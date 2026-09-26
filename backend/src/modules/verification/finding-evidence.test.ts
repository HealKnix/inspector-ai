import { describe, expect, it } from "vitest";
import {
  frozenFindingEvidencePreview,
  hasFrozenFindingEvidence,
} from "./finding-evidence.js";

const fragment = {
  extractionId: "extraction-1",
  fileId: "file-1",
  artifactId: "artifact-1",
  pageNumber: 2,
  blockId: "p2-b1",
  quote: "Площадь 120 м2",
  bbox: null,
};
const member = {
  extraction_id: fragment.extractionId,
  file_id: fragment.fileId,
  artifact_id: fragment.artifactId,
  status: "extracted",
  value: 120,
  evidence: [fragment],
};

function snapshot(overrides: Record<string, unknown> = {}) {
  return { schema_version: 1, members: [{ ...member, ...overrides }] };
}

describe("hasFrozenFindingEvidence", () => {
  it("keeps a single located source even without a comparison counterpart", () => {
    expect(hasFrozenFindingEvidence(snapshot())).toBe(true);
  });

  it("keeps ambiguous recognition with source fragments but no selected value", () => {
    expect(
      hasFrozenFindingEvidence(snapshot({ status: "ambiguous", value: null })),
    ).toBe(true);
  });

  it.each([
    { blockId: null, bbox: [0.1, 0.2, 0.8, 0.9] },
    { blockId: null, structuralPath: "/Act/Works/Area" },
    { artifactId: undefined },
  ])("accepts a frozen source locator %j", (locator) => {
    expect(
      hasFrozenFindingEvidence(
        snapshot({ evidence: [{ ...fragment, ...locator }] }),
      ),
    ).toBe(true);
  });

  it.each([null, [], {}, { members: [] }, { members: [null] }])(
    "does not infer evidence from an absent or malformed snapshot %j",
    (value) => {
      expect(hasFrozenFindingEvidence(value)).toBe(false);
    },
  );

  it.each(["no_evidence", "unsupported", "unreadable"])(
    "does not turn source status %s into a finding",
    (status) => {
      expect(hasFrozenFindingEvidence(snapshot({ status }))).toBe(false);
    },
  );

  it("does not treat an extracted value without a source fragment as evidence", () => {
    expect(hasFrozenFindingEvidence(snapshot({ evidence: [] }))).toBe(false);
  });

  it.each([
    { extractionId: "foreign-extraction" },
    { fileId: "foreign-file" },
    { artifactId: "foreign-artifact" },
    { quote: " \n " },
    { pageNumber: 0 },
    { pageNumber: 1.5 },
    { blockId: null },
    { blockId: " ", bbox: [0.8, 0.2, 0.1, 0.9] },
    { blockId: null, bbox: [0.1, -1, 0.8, 0.9] },
    { blockId: null, bbox: [0.1, 0.2, 0.8] },
  ])("rejects mismatched or unlocated proof %j", (invalid) => {
    expect(
      hasFrozenFindingEvidence(
        snapshot({ evidence: [{ ...fragment, ...invalid }] }),
      ),
    ).toBe(false);
  });

  it("does not substitute current artifacts for unbound historical evidence", () => {
    expect(
      hasFrozenFindingEvidence(
        snapshot({
          artifact_id: undefined,
          evidence: [{ ...fragment, artifactId: undefined }],
        }),
      ),
    ).toBe(false);
  });
});

describe("frozenFindingEvidencePreview", () => {
  it("returns actual-side evidence without relying on verdict arrays", () => {
    expect(
      frozenFindingEvidencePreview(
        snapshot({ role: "actual", value_raw: "120", unit: "м2" }),
      ),
    ).toEqual({
      file_id: "file-1",
      role: "actual",
      value: 120,
      value_raw: "120",
      unit: "м2",
      quote: fragment.quote,
    });
  });

  it("retains ambiguous quotes without inventing a selected value", () => {
    expect(
      frozenFindingEvidencePreview(
        snapshot({ status: "ambiguous", value: null, value_raw: null }),
      ),
    ).toEqual({
      file_id: "file-1",
      role: "unknown",
      value: null,
      value_raw: null,
      unit: null,
      quote: fragment.quote,
    });
  });

  it("skips foreign proof before choosing the first owned fragment", () => {
    expect(
      frozenFindingEvidencePreview(
        snapshot({
          evidence: [
            { ...fragment, fileId: "foreign-file", quote: "Foreign quote" },
            fragment,
            { ...fragment, quote: "Later owned quote" },
          ],
        }),
      )?.quote,
    ).toBe(fragment.quote);
  });

  it("returns null for absent proof", () => {
    expect(frozenFindingEvidencePreview(snapshot({ evidence: [] }))).toBeNull();
    expect(frozenFindingEvidencePreview(null)).toBeNull();
  });
});
