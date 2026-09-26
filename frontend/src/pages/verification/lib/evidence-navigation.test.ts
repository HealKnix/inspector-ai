import { parsedFile } from "@/api/types/parsing-test-fixtures";
import type { ApiFindingDetail } from "@/api/types/verification";
import { evidenceForPage, evidenceRectangle } from "./evidence-navigation";

const detail: ApiFindingDetail = {
  id: "finding",
  parameter_code: "P001",
  scope_key: "scope",
  status: "CANDIDATE",
  risk: null,
  reason_code: null,
  comment: null,
  decided_at: null,
  has_evidence: true,
  evidence_preview: null,
  finding_version: 1,
  gate_reasons: [],
  verdict: null,
  protocol_version: 1,
  run_id: parsedFile.run_id,
  decisions: [],
  members: [
    {
      extraction_id: "extraction",
      file_id: parsedFile.file_id,
      artifact_id: parsedFile.artifact_id!,
      stage: "RD",
      role: "expected",
      status: "extracted",
      value: 2,
      value_raw: "2",
      unit: null,
      evidence: [
        {
          extractionId: "extraction",
          fileId: parsedFile.file_id,
          artifactId: parsedFile.artifact_id!,
          pageNumber: 2,
          blockId: "same-block-id",
          sheetLabel: null,
          quote: "Точное доказательство",
          bbox: [0.1, 0.2, 0.3, 0.4],
        },
      ],
    },
  ],
};

describe("immutable evidence locator", () => {
  it("retains only the exact source, artifact, run and page", () => {
    expect(evidenceForPage(detail, parsedFile, 2)).toHaveLength(1);
    expect(
      evidenceForPage(detail, { ...parsedFile, file_id: "other" }, 2),
    ).toEqual([]);
    expect(
      evidenceForPage(detail, { ...parsedFile, artifact_id: "other" }, 2),
    ).toEqual([]);
    expect(
      evidenceForPage(detail, { ...parsedFile, run_id: "other" }, 2),
    ).toEqual([]);
    expect(evidenceForPage(detail, parsedFile, 1)).toEqual([]);
    expect(
      evidenceForPage({ ...detail, run_id: undefined }, parsedFile, 2),
    ).toEqual([]);
    const conflicting = structuredClone(detail);
    conflicting.members[0]!.evidence[0]!.artifactId = "other";
    expect(evidenceForPage(conflicting, parsedFile, 2)).toEqual([]);
  });

  it("uses a valid evidence rectangle even without a parser block id", () => {
    const source = structuredClone(detail);
    source.members[0]!.evidence[0]!.blockId = null;
    const fragment = evidenceForPage(source, parsedFile, 2)[0]!;
    expect(evidenceRectangle(fragment.bbox)).toEqual([0.1, 0.2, 0.3, 0.4]);
    for (const invalid of [
      null,
      [],
      [0, 0, 2, 1],
      [0.5, 0, 0.1, 1],
      [0, 0, Number.NaN, 1],
    ]) {
      expect(evidenceRectangle(invalid)).toBeNull();
    }
  });
});
