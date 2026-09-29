import { mockVerificationPackage } from "./verification-test-fixtures";

import {
  FindingStatus,
  ReviewPriority,
  VerificationFindingSort,
  VerificationUiMarker,
} from "../types";
import {
  applyLocalFindingDecision,
  filterVerificationFindings,
  getVerificationSummary,
  searchVerificationFindings,
  sortVerificationFindings,
} from "./verification";

const findings = mockVerificationPackage.findings;

describe("searchVerificationFindings", () => {
  it("ищет без учёта регистра и внешних пробелов", () => {
    const result = searchVerificationFindings(findings, "  ГИДРОИЗОЛЯЦИИ  ");

    expect(result.map((finding) => finding.ordinal)).toEqual([31]);
  });

  it("ищет по значениям и местоположению доказательств", () => {
    expect(
      searchVerificationFindings(findings, "ДЕМО-ПИ-041").map(
        (finding) => finding.ordinal,
      ),
    ).toEqual([38]);
    expect(
      searchVerificationFindings(findings, "Демо-лист ИД-47").map(
        (finding) => finding.ordinal,
      ),
    ).toEqual([47]);
  });

  it("ищет по метаданным связанных документов", () => {
    const result = searchVerificationFindings(
      findings,
      "ДЕМО-ПД-ЭТАЛОН",
      mockVerificationPackage.documents,
    );

    expect(result.map((finding) => finding.ordinal)).toContain(1);
  });

  it("возвращает новую копию списка для пустого запроса", () => {
    const result = searchVerificationFindings(findings, "  ");

    expect(result).toEqual(findings);
    expect(result).not.toBe(findings);
  });
});

describe("filterVerificationFindings", () => {
  it("совмещает поиск, маркер, статус и приоритет", () => {
    const result = filterVerificationFindings(findings, {
      query: "демо",
      uiMarker: VerificationUiMarker.ATTENTION,
      findingStatus: FindingStatus.CANDIDATE,
      reviewPriority: ReviewPriority.MEDIUM,
    });

    expect(result.map((finding) => finding.ordinal)).toEqual([16, 18]);
  });

  it("поддерживает независимый фильтр по каждому измерению", () => {
    expect(
      filterVerificationFindings(findings, {
        query: "",
        uiMarker: VerificationUiMarker.FORMALITY,
        findingStatus: "all",
        reviewPriority: "all",
      }),
    ).toHaveLength(26);

    expect(
      filterVerificationFindings(findings, {
        query: "",
        uiMarker: "all",
        findingStatus: FindingStatus.NEGATIVE_VERIFIED,
        reviewPriority: "all",
      }),
    ).toHaveLength(7);
  });
});

describe("sortVerificationFindings", () => {
  const unsorted = [findings[46]!, findings[12]!, findings[0]!];

  it("сортирует по значимости и сохраняет исходный список", () => {
    const result = sortVerificationFindings(
      unsorted,
      VerificationFindingSort.PRIORITY,
    );

    expect(result.map((finding) => finding.ordinal)).toEqual([1, 13, 47]);
    expect(unsorted.map((finding) => finding.ordinal)).toEqual([47, 13, 1]);
  });

  it("сортирует по статусу, маркеру, заголовку и исходному порядку", () => {
    expect(
      sortVerificationFindings(unsorted, VerificationFindingSort.STATUS).map(
        (finding) => finding.ordinal,
      ),
    ).toEqual([1, 13, 47]);
    expect(
      sortVerificationFindings(unsorted, VerificationFindingSort.MARKER).map(
        (finding) => finding.ordinal,
      ),
    ).toEqual([1, 13, 47]);
    expect(
      sortVerificationFindings(unsorted, VerificationFindingSort.ORDINAL).map(
        (finding) => finding.ordinal,
      ),
    ).toEqual([1, 13, 47]);

    const byTitle = sortVerificationFindings(
      unsorted,
      VerificationFindingSort.TITLE,
    );
    const expectedTitles = unsorted
      .map((finding) => finding.title)
      .sort((first, second) => first.localeCompare(second, "ru-RU"));

    expect(byTitle.map((finding) => finding.title)).toEqual(expectedTitles);
  });
});

describe("getVerificationSummary", () => {
  it("считает прогресс и независимые распределения", () => {
    const summary = getVerificationSummary(findings);

    expect(summary.totalCount).toBe(47);
    expect(summary.processedCount).toBe(18);
    expect(summary.pendingCount).toBe(29);
    expect(summary.processedPercent).toBe(38);
    expect(summary.markerCounts).toEqual({
      [VerificationUiMarker.IMPACT]: 12,
      [VerificationUiMarker.ATTENTION]: 9,
      [VerificationUiMarker.FORMALITY]: 26,
    });
  });

  it("возвращает нулевую сводку для пустого списка", () => {
    expect(getVerificationSummary([])).toEqual({
      totalCount: 0,
      processedCount: 0,
      pendingCount: 0,
      processedPercent: 0,
      markerCounts: {
        [VerificationUiMarker.IMPACT]: 0,
        [VerificationUiMarker.ATTENTION]: 0,
        [VerificationUiMarker.FORMALITY]: 0,
      },
      statusCounts: {
        [FindingStatus.CANDIDATE]: 0,
        [FindingStatus.CONFIRMED_VIOLATION]: 0,
        [FindingStatus.NEGATIVE_VERIFIED]: 0,
        [FindingStatus.CLARIFICATION_REQUIRED]: 0,
        [FindingStatus.MISSING_EVIDENCE]: 0,
        [FindingStatus.NOT_COMPARABLE]: 0,
        [FindingStatus.NOT_APPLICABLE]: 0,
      },
      priorityCounts: {
        [ReviewPriority.HIGH]: 0,
        [ReviewPriority.MEDIUM]: 0,
        [ReviewPriority.LOW]: 0,
      },
    });
  });
});

describe("applyLocalFindingDecision", () => {
  const candidate = findings.find(
    (finding) => finding.findingStatus === FindingStatus.CANDIDATE,
  );

  if (!candidate) {
    throw new Error("В fixture нет кандидата для теста.");
  }

  it("для отрицательного результата требует причину и комментарий", () => {
    expect(() =>
      applyLocalFindingDecision(findings, candidate.id, {
        findingStatus: FindingStatus.NEGATIVE_VERIFIED,
        reason: "  ",
        comment: "Комментарий",
      }),
    ).toThrow("необходимо указать причину");

    expect(() =>
      applyLocalFindingDecision(findings, candidate.id, {
        findingStatus: FindingStatus.NEGATIVE_VERIFIED,
        reason: "Причина",
        comment: "  ",
      }),
    ).toThrow("нужен комментарий");
  });

  it("применяет отрицательное решение без мутации исходных данных", () => {
    const result = applyLocalFindingDecision(findings, candidate.id, {
      findingStatus: FindingStatus.NEGATIVE_VERIFIED,
      reason: "  Ошибка сопоставления в демо  ",
      comment: "  Проверено вручную в учебном сценарии  ",
    });
    const updatedFinding = result.find(
      (finding) => finding.id === candidate.id,
    );

    expect(updatedFinding).toMatchObject({
      findingStatus: FindingStatus.NEGATIVE_VERIFIED,
      decisionReason: "Ошибка сопоставления в демо",
      reviewComment: "Проверено вручную в учебном сценарии",
    });
    expect(candidate.findingStatus).toBe(FindingStatus.CANDIDATE);
    expect(getVerificationSummary(result).processedCount).toBe(19);
  });

  it.each([
    FindingStatus.CONFIRMED_VIOLATION,
    FindingStatus.CLARIFICATION_REQUIRED,
  ] as const)("применяет решение %s с обязательным комментарием", (status) => {
    const result = applyLocalFindingDecision(findings, candidate.id, {
      findingStatus: status,
      comment: "  Учебный комментарий  ",
    });
    const updatedFinding = result.find(
      (finding) => finding.id === candidate.id,
    );

    expect(updatedFinding).toMatchObject({
      findingStatus: status,
      decisionReason: null,
      reviewComment: "Учебный комментарий",
    });
  });

  it("отклоняет решение для неизвестного расхождения", () => {
    expect(() =>
      applyLocalFindingDecision(findings, "missing-demo-finding", {
        findingStatus: FindingStatus.CONFIRMED_VIOLATION,
        comment: "Учебный комментарий",
      }),
    ).toThrow("не найдено");
  });
});
