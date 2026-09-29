import type { ApiFinding, ApiFindingDetail } from "@/api/types/verification";
import {
  FindingStatusGroup,
  decisionActionFor,
  filterFindingsByGroup,
  labelForRejectionCode,
  markerForRisk,
  pickEvidencePair,
  priorityForRisk,
  rejectionCodeForLabel,
  toVerificationFinding,
} from "@/pages/verification/lib/object-findings";
import {
  FindingStatus,
  ReviewPriority,
  VerificationUiMarker,
} from "@/pages/verification/types";

const filePd = "22222222-2222-4222-8222-222222222222";
const fileRd = "77777777-7777-4777-8777-777777777777";
const extExpected = "88888888-8888-4888-8888-888888888888";
const extActual = "99999999-9999-4999-8999-999999999999";
const findingId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function listItem(overrides: Partial<ApiFinding> = {}): ApiFinding {
  return {
    id: findingId,
    parameter_code: "P022",
    parameter_name: "Класс стойкости",
    scope_key: "object",
    status: "CANDIDATE",
    risk: "критичный",
    reason_code: null,
    comment: null,
    decided_at: null,
    has_evidence: true,
    evidence_preview: null,
    finding_version: 3,
    gate_reasons: null,
    verdict: {
      engine: "comparison-v1",
      status: "discrepancy",
      spec: { kind: "equals" },
      expected: [
        {
          extraction_id: extExpected,
          file_id: filePd,
          value: "II",
          value_raw: "II",
          unit: null,
        },
      ],
      actual: [
        {
          extraction_id: extActual,
          file_id: fileRd,
          value: "l",
          value_raw: "l",
          unit: null,
        },
      ],
      pairs: [
        {
          expected_extraction_id: extExpected,
          actual_extraction_id: extActual,
          result: "mismatch",
          delta: null,
          delta_pct: null,
          detail: "Значения различаются",
        },
      ],
      warnings: [],
      evaluated_at: "2026-10-01T00:00:00.000Z",
    },
    ...overrides,
  };
}

function detail(overrides: Partial<ApiFindingDetail> = {}): ApiFindingDetail {
  return {
    ...listItem(),
    protocol_version: 1,
    members: [
      {
        extraction_id: extExpected,
        file_id: filePd,
        stage: "PD",
        role: "expected",
        status: "extracted",
        value: "II",
        value_raw: "II",
        unit: null,
        evidence: [
          {
            extractionId: extExpected,
            fileId: filePd,
            pageNumber: 12,
            sheetLabel: null,
            blockId: "p12-b72",
            quote: "Класс стойкости II",
            bbox: [0.1, 0.2, 0.5, 0.3],
          },
        ],
      },
      {
        extraction_id: extActual,
        file_id: fileRd,
        stage: "RD",
        role: "actual",
        status: "extracted",
        value: "l",
        value_raw: "l",
        unit: null,
        evidence: [
          {
            extractionId: extActual,
            fileId: fileRd,
            pageNumber: 5,
            sheetLabel: "КЖ-1",
            blockId: "p5-b10",
            quote: "класс стойкости l",
            bbox: null,
          },
        ],
      },
    ],
    decisions: [],
    ...overrides,
  };
}

describe("toVerificationFinding", () => {
  it("показывает найденное значение и цитату одной стороны до загрузки карточки", () => {
    const finding = toVerificationFinding(
      listItem({
        status: "CLARIFICATION_REQUIRED",
        verdict: null,
        evidence_preview: {
          file_id: fileRd,
          role: "actual",
          value: 163.46,
          value_raw: "163,46",
          unit: "м²",
          quote: "Синтетическая площадь 163,46 м²",
        },
      }),
      1,
    );

    expect(finding.expectedEvidence.value).toBe("—");
    expect(finding.actualEvidence).toMatchObject({
      documentId: fileRd,
      value: "163,46 м²",
      excerpt: "Синтетическая площадь 163,46 м²",
    });
  });

  it("сохраняет цитату неоднозначного фрагмента без выдуманного значения", () => {
    const finding = toVerificationFinding(
      listItem({
        status: "CLARIFICATION_REQUIRED",
        verdict: null,
        evidence_preview: {
          file_id: fileRd,
          role: "unknown",
          value: null,
          value_raw: null,
          unit: null,
          quote: "Синтетический неоднозначный фрагмент",
        },
      }),
      1,
    );

    expect(finding.expectedEvidence.value).toBe("—");
    expect(finding.actualEvidence.value).toBe("—");
    expect(finding.sourcePreview).toBe("Синтетический неоднозначный фрагмент");
  });

  it("маппит элемент списка в модель формы со значениями вердикта", () => {
    const finding = toVerificationFinding(listItem(), 7);

    expect(finding).toMatchObject({
      id: findingId,
      ordinal: 7,
      title: "P022 · Класс стойкости",
      findingStatus: "CANDIDATE",
      findingVersion: 3,
      isSynthetic: false,
      source: "api",
      verdictStatus: "discrepancy",
      uiMarker: VerificationUiMarker.IMPACT,
      reviewPriority: ReviewPriority.HIGH,
    });
    expect(finding.expectedEvidence).toMatchObject({
      documentId: filePd,
      value: "II",
    });
    expect(finding.actualEvidence).toMatchObject({
      documentId: fileRd,
      value: "l",
    });
    expect(finding.description).toContain("различаются");
  });

  it("подставляет локаторы из detail, когда карточка загружена", () => {
    const finding = toVerificationFinding(listItem(), 1, detail());

    expect(finding.expectedEvidence).toMatchObject({
      documentId: filePd,
      page: 12,
      location: "p12-b72",
      excerpt: "Класс стойкости II",
    });
    expect(finding.actualEvidence).toMatchObject({
      documentId: fileRd,
      page: 5,
      location: "p5-b10",
    });
  });

  it("не выдумывает значения для MISSING_EVIDENCE", () => {
    const finding = toVerificationFinding(
      listItem({ status: "MISSING_EVIDENCE", verdict: null, risk: null }),
      1,
    );

    expect(finding.expectedEvidence.value).toBe("—");
    expect(finding.actualEvidence.value).toBe("—");
    expect(finding.uiMarker).toBe(VerificationUiMarker.FORMALITY);
  });

  it("отображает причину отклонения человекочитаемой меткой", () => {
    const finding = toVerificationFinding(
      listItem({
        status: "NEGATIVE_VERIFIED",
        reason_code: "ocr_error",
        comment: "На скане читается II",
      }),
      1,
    );

    expect(finding.decisionReason).toBe("Ошибка OCR");
    expect(finding.reviewComment).toBe("На скане читается II");
  });
});

describe("pickEvidencePair", () => {
  it("выбирает членов по ссылкам первой пары вердикта", () => {
    const pair = pickEvidencePair(detail());

    expect(pair.expected?.member.extraction_id).toBe(extExpected);
    expect(pair.expected?.fragment?.blockId).toBe("p12-b72");
    expect(pair.actual?.member.extraction_id).toBe(extActual);
  });

  it("отступает к первому члену роли со значением без пар вердикта", () => {
    const withoutPairs = detail({
      verdict: { ...detail().verdict!, pairs: [] },
    });
    const pair = pickEvidencePair(withoutPairs);

    expect(pair.expected?.member.file_id).toBe(filePd);
    expect(pair.actual?.member.file_id).toBe(fileRd);
  });

  it("возвращает null для роли без членов", () => {
    const pair = pickEvidencePair(
      detail({ members: detail().members.slice(0, 1) }),
    );

    expect(pair.expected).not.toBeNull();
    expect(pair.actual).toBeNull();
  });
});

describe("группы статусов", () => {
  const items = [
    listItem({ id: findingId, status: "CANDIDATE" }),
    listItem({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      status: "MISSING_EVIDENCE",
      verdict: null,
    }),
    listItem({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      status: "NOT_COMPARABLE",
      verdict: null,
    }),
  ].map((item, index) => toVerificationFinding(item, index + 1));

  it("раскладывает находки по фильтр-группам", () => {
    expect(
      filterFindingsByGroup(items, FindingStatusGroup.CANDIDATES),
    ).toHaveLength(1);
    expect(
      filterFindingsByGroup(items, FindingStatusGroup.NO_EVIDENCE),
    ).toHaveLength(1);
    expect(
      filterFindingsByGroup(items, FindingStatusGroup.NOT_COMPARABLE),
    ).toHaveLength(1);
    expect(
      filterFindingsByGroup(items, FindingStatusGroup.NOT_APPLICABLE),
    ).toHaveLength(0);
    expect(filterFindingsByGroup(items, "all")).toHaveLength(3);
  });
});

describe("риск → представление", () => {
  it("маппит критичность в маркер и приоритет", () => {
    expect(markerForRisk("критичный")).toBe(VerificationUiMarker.IMPACT);
    expect(priorityForRisk("существенный")).toBe(ReviewPriority.MEDIUM);
    expect(markerForRisk(null)).toBe(VerificationUiMarker.FORMALITY);
  });
});

describe("решения", () => {
  it("маппит целевой статус в действие API", () => {
    expect(decisionActionFor(FindingStatus.CONFIRMED_VIOLATION)).toBe(
      "confirm",
    );
    expect(decisionActionFor(FindingStatus.NEGATIVE_VERIFIED)).toBe("reject");
    expect(decisionActionFor(FindingStatus.CLARIFICATION_REQUIRED)).toBe(
      "clarify",
    );
    expect(decisionActionFor(FindingStatus.CANDIDATE)).toBe("reopen");
  });

  it("переводит метки причин в машинные коды и обратно", () => {
    for (const { code, label } of [
      { code: "wrong_revision", label: "Актуальная редакция выбрана неверно" },
      { code: "approved_change", label: "Есть согласованное изменение" },
      { code: "ocr_error", label: "Ошибка OCR" },
      {
        code: "evidence_binding_error",
        label: "Ошибка привязки доказательства",
      },
      { code: "not_applicable", label: "Параметр неприменим" },
    ]) {
      expect(rejectionCodeForLabel(label)).toBe(code);
      expect(labelForRejectionCode(code)).toBe(label);
    }
    expect(rejectionCodeForLabel("причина вне списка")).toBeNull();
  });
});
