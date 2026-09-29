import type { ParsingFile } from "@/api/types/parsing";
import { parsedFile } from "@/api/types/parsing-test-fixtures";
import {
  sectionActualEvidence,
  sectionReferenceEvidence,
  sectionRunId,
  sectionSnapshot,
} from "@/api/types/section-analysis-test-fixtures";
import type { ApiFindingDetail } from "@/api/types/verification";
import {
  comparisonSourceTargets,
  evidenceForPage,
  evidenceRectangle,
  sectionEvidenceTargets,
  sectionSourceFiles,
} from "./evidence-navigation";

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
  it("resolves composite links only within the saved run, extraction and artifact", () => {
    expect(comparisonSourceTargets(detail, [parsedFile])).toEqual([
      {
        extractionId: "extraction",
        fileId: parsedFile.file_id,
        artifactId: parsedFile.artifact_id,
        page: 2,
        blockId: "same-block-id",
        label: parsedFile.original_name,
      },
    ]);
    expect(
      comparisonSourceTargets({ ...detail, run_id: "another-run" }, [
        parsedFile,
      ]),
    ).toEqual([]);
    expect(
      comparisonSourceTargets(detail, [
        { ...parsedFile, artifact_id: "another-artifact" },
      ]),
    ).toEqual([]);
    const conflicting = structuredClone(detail);
    conflicting.members[0]!.evidence[0]!.extractionId = "another-extraction";
    expect(comparisonSourceTargets(conflicting, [parsedFile])).toEqual([]);
    conflicting.members[0]!.evidence[0]!.extractionId = "extraction";
    conflicting.members[0]!.evidence[0]!.fileId = "another-file";
    expect(comparisonSourceTargets(conflicting, [parsedFile])).toEqual([]);
  });
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

describe("section evidence navigation", () => {
  const referenceFile: ParsingFile = {
    file_id: sectionReferenceEvidence.file_id,
    process_id: parsedFile.process_id,
    run_id: sectionRunId,
    artifact_id: sectionReferenceEvidence.artifact_id,
    original_name: "ПД-раздел.pdf",
    state: "succeeded",
    attempt: 1,
    pages_completed: 3,
    pages_total: 3,
    quality: "OK",
    reasons: [],
    error_code: null,
    can_retry: false,
  };
  const actualFile: ParsingFile = {
    ...referenceFile,
    file_id: sectionActualEvidence.file_id,
    artifact_id: sectionActualEvidence.artifact_id,
    original_name: "РД-листы.pdf",
  };
  const sectionDetail: ApiFindingDetail = {
    ...detail,
    run_id: sectionRunId,
    members: [],
    section_analysis: sectionSnapshot,
  };

  it("highlights section citations on both immutable sources", () => {
    const reference = evidenceForPage(sectionDetail, referenceFile, 3);
    expect(reference).toEqual([
      {
        fileId: sectionReferenceEvidence.file_id,
        pageNumber: 3,
        blockId: "blk-pd-7",
        quote: "Класс бетона В25",
        bbox: [0.1, 0.2, 0.4, 0.3],
      },
    ]);
    const actual = evidenceForPage(sectionDetail, actualFile, 5);
    expect(actual).toHaveLength(1);
    expect(actual[0]?.quote).toBe("Класс бетона В30");
    expect(actual[0]?.blockId).toBe("blk-rd-11");
  });

  it("keeps section citations bound to their own artifact, run and page", () => {
    expect(
      evidenceForPage(
        sectionDetail,
        {
          ...referenceFile,
          artifact_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
        },
        3,
      ),
    ).toEqual([]);
    expect(
      evidenceForPage(sectionDetail, { ...referenceFile, run_id: "x" }, 3),
    ).toEqual([]);
    expect(evidenceForPage(sectionDetail, referenceFile, 5)).toEqual([]);
    expect(evidenceForPage(sectionDetail, actualFile, 3)).toEqual([]);
    const noSection = structuredClone(sectionDetail);
    noSection.section_analysis = null;
    expect(evidenceForPage(noSection, referenceFile, 3)).toEqual([]);
  });

  it("resolves citation targets for both roles without invented ids", () => {
    const targets = sectionEvidenceTargets(sectionDetail, [
      referenceFile,
      actualFile,
    ]);
    expect(targets).toEqual([
      {
        fileId: referenceFile.file_id,
        artifactId: referenceFile.artifact_id,
        page: 3,
        blockId: "blk-pd-7",
        role: "reference",
        quote: "Класс бетона В25",
        label: "ПД-раздел.pdf",
      },
      {
        fileId: actualFile.file_id,
        artifactId: actualFile.artifact_id,
        page: 5,
        blockId: "blk-rd-11",
        role: "actual",
        quote: "Класс бетона В30",
        label: "РД-листы.pdf",
      },
    ]);
    for (const target of targets) {
      expect(target).not.toHaveProperty("extractionId");
    }
    // A file from another run or artifact cannot masquerade as the source.
    expect(
      sectionEvidenceTargets(sectionDetail, [
        { ...referenceFile, run_id: "other-run" },
      ]),
    ).toEqual([]);
  });

  it("builds frozen source descriptors for the parse panes", () => {
    const files = sectionSourceFiles(sectionDetail, [
      {
        ...referenceFile,
        original_name: "Актуальное имя.pdf",
      },
    ]);
    expect(files).toHaveLength(2);
    const reference = files.find(
      (file) => file.file_id === sectionReferenceEvidence.file_id,
    )!;
    expect(reference.artifact_id).toBe(sectionReferenceEvidence.artifact_id);
    expect(reference.run_id).toBe(sectionRunId);
    expect(reference.original_name).toBe("Актуальное имя.pdf");
    const missing = sectionSourceFiles(
      { ...sectionDetail, section_analysis: null },
      [],
    );
    expect(missing).toEqual([]);
  });
});
