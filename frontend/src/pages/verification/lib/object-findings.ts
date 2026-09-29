import type { ParsingFile } from "@/api/types/parsing";
import type {
  SectionAnalysisSnapshot,
  SectionAssessment,
  SectionEvidence,
} from "@/api/types/section-analysis";
import type {
  ApiFinding,
  ApiFindingDetail,
  EvidenceFragment,
  GroupMember,
} from "@/api/types/verification";
import {
  FindingStatus,
  ReviewPriority,
  VERIFICATION_API_SOURCE,
  VerificationDocumentPreviewKind,
  VerificationDocumentStage,
  VerificationUiMarker,
  type VerificationDocument,
  type VerificationEvidence,
  type VerificationFinding,
} from "@/pages/verification/types";
import { verificationReason } from "./verification-messages";

/**
 * Машинные коды причин отклонения — 1:1 по смыслу с backend
 * REJECTION_REASON_CODES; метки переиспользует форма DiscrepancyDetails.
 */
export const REJECTION_REASONS = [
  { code: "wrong_revision", label: "Актуальная редакция выбрана неверно" },
  { code: "approved_change", label: "Есть согласованное изменение" },
  { code: "ocr_error", label: "Ошибка OCR" },
  { code: "evidence_binding_error", label: "Ошибка привязки доказательства" },
  { code: "not_applicable", label: "Параметр неприменим" },
  { code: "no_discrepancy", label: "Расхождение не подтверждено" },
] as const;

export type RejectionReasonCode = (typeof REJECTION_REASONS)[number]["code"];

export function rejectionCodeForLabel(
  label: string,
): RejectionReasonCode | null {
  const match = REJECTION_REASONS.find((reason) => reason.label === label);
  return match?.code ?? null;
}

export function labelForRejectionCode(code: string | null): string | null {
  if (!code) return null;
  return (
    REJECTION_REASONS.find((reason) => reason.code === code)?.label ?? code
  );
}

/** Статусы, по которым инспектор может принимать решение через API. */
export const DECIDABLE_STATUSES: readonly FindingStatus[] = [
  FindingStatus.CANDIDATE,
  FindingStatus.CONFIRMED_VIOLATION,
  FindingStatus.NEGATIVE_VERIFIED,
  FindingStatus.CLARIFICATION_REQUIRED,
];

export function isDecidableStatus(status: FindingStatus): boolean {
  return DECIDABLE_STATUSES.includes(status);
}

/** Фильтр-группы списка находок: статусов больше, чем вкладок. */
export const FindingStatusGroup = {
  CANDIDATES: "candidates",
  DECIDED: "decided",
  CLARIFICATION: "clarification",
  NO_EVIDENCE: "no_evidence",
  NOT_APPLICABLE: "not_applicable",
  NOT_COMPARABLE: "not_comparable",
} as const;

export type FindingStatusGroup =
  (typeof FindingStatusGroup)[keyof typeof FindingStatusGroup];

export const findingStatusGroupLabels: Record<
  FindingStatusGroup | "all",
  string
> = {
  all: "Все",
  [FindingStatusGroup.CANDIDATES]: "Требуют решения",
  [FindingStatusGroup.DECIDED]: "Решённые",
  [FindingStatusGroup.CLARIFICATION]: "Уточнения",
  [FindingStatusGroup.NO_EVIDENCE]: "Нет доказательств",
  [FindingStatusGroup.NOT_APPLICABLE]: "Неприменимые",
  [FindingStatusGroup.NOT_COMPARABLE]: "Несопоставимые",
};

const groupStatuses: Record<FindingStatusGroup, readonly FindingStatus[]> = {
  [FindingStatusGroup.CANDIDATES]: [FindingStatus.CANDIDATE],
  [FindingStatusGroup.DECIDED]: [
    FindingStatus.CONFIRMED_VIOLATION,
    FindingStatus.NEGATIVE_VERIFIED,
  ],
  [FindingStatusGroup.CLARIFICATION]: [FindingStatus.CLARIFICATION_REQUIRED],
  [FindingStatusGroup.NO_EVIDENCE]: [FindingStatus.MISSING_EVIDENCE],
  [FindingStatusGroup.NOT_APPLICABLE]: [FindingStatus.NOT_APPLICABLE],
  [FindingStatusGroup.NOT_COMPARABLE]: [FindingStatus.NOT_COMPARABLE],
};

export function findingStatusGroup(status: FindingStatus): FindingStatusGroup {
  for (const [group, statuses] of Object.entries(groupStatuses)) {
    if (statuses.includes(status)) return group as FindingStatusGroup;
  }
  return FindingStatusGroup.NO_EVIDENCE;
}

export function filterFindingsByGroup(
  findings: readonly VerificationFinding[],
  group: FindingStatusGroup | "all",
): VerificationFinding[] {
  if (group === "all") return [...findings];
  const statuses = groupStatuses[group];
  return findings.filter((finding) => statuses.includes(finding.findingStatus));
}

export function markerForRisk(risk: string | null): VerificationUiMarker {
  const normalized = risk?.toLocaleLowerCase("ru-RU") ?? "";
  if (normalized.includes("критич")) return VerificationUiMarker.IMPACT;
  if (normalized.includes("существен")) return VerificationUiMarker.ATTENTION;
  return VerificationUiMarker.FORMALITY;
}

export function priorityForRisk(risk: string | null): ReviewPriority {
  const normalized = risk?.toLocaleLowerCase("ru-RU") ?? "";
  if (normalized.includes("критич")) return ReviewPriority.HIGH;
  if (normalized.includes("существен")) return ReviewPriority.MEDIUM;
  return ReviewPriority.LOW;
}

const verdictStatusText: Record<string, string> = {
  match: "Извлечённые значения совпадают.",
  discrepancy: "Извлечённые значения различаются.",
  expected_missing: "Значение не найдено в эталонном документе.",
  actual_missing: "Значение не найдено в проверяемом документе.",
  expected_ambiguous:
    "В документах ожидаемой стадии найдено несколько разных значений.",
  actual_ambiguous:
    "В проверяемых документах найдено несколько разных значений.",
  not_comparable: "Извлечённые значения несопоставимы по типу правила.",
  no_comparison: "Сравнение по этому параметру не выполнено.",
};

/** Предварительная оценка анализа разделов — не решение инспектора. */
export const sectionAssessmentText: Record<SectionAssessment, string> = {
  potential_difference:
    "Анализ разделов предварительно указывает на возможное расхождение.",
  proposed_agreement:
    "Анализ разделов предварительно не нашёл расхождения — решение остаётся за инспектором.",
  insufficient_context:
    "Анализ разделов не получил достаточного контекста для вывода.",
};

export function describeFinding(finding: ApiFinding): string {
  const verdict = finding.verdict;
  const parts: string[] = [];
  if (verdict) {
    parts.push(
      verdictStatusText[verdict.status] ??
        "Результат сравнения требует уточнения.",
    );
    const detail = verdict.pairs.find((pair) => pair.detail)?.detail;
    if (detail) parts.push(verificationReason(detail));
    parts.push(...verdict.warnings.map(verificationReason));
  }
  const section = finding.section_analysis;
  if (section) {
    parts.push(sectionAssessmentText[section.assessment]);
    if (section.fact) parts.push(section.fact);
    if (!section.coverage.complete) parts.push("Раздел проверен не полностью.");
  }
  if (finding.gate_reasons?.length) {
    parts.push(...finding.gate_reasons.map(verificationReason));
  }
  if (!parts.length) {
    parts.push("Доказательства по параметру не собраны.");
  }
  return [...new Set(parts)].join(" ");
}

function refValue(member: {
  value: number | string | null;
  value_raw: string | null;
  unit: string | null;
}): string {
  const raw = member.value_raw ?? member.value;
  if (raw === null || raw === undefined || raw === "") return "—";
  return member.unit ? `${raw} ${member.unit}` : String(raw);
}

const emptyEvidence: VerificationEvidence = {
  documentId: "",
  page: 0,
  location: "—",
  excerpt: "",
  value: "—",
};

function evidenceFromMember(
  member: GroupMember | undefined,
  fragment?: EvidenceFragment,
): VerificationEvidence {
  if (!member) return emptyEvidence;
  return {
    documentId: member.file_id,
    page: fragment?.pageNumber ?? 0,
    location: fragment
      ? (fragment.blockId ??
        fragment.sheetLabel ??
        `стр. ${fragment.pageNumber}`)
      : "—",
    excerpt: fragment?.quote ?? "",
    value: refValue(member),
  };
}

/** Цитата анализа разделов → сторона карточки (без числового значения). */
function evidenceFromSection(item: SectionEvidence): VerificationEvidence {
  return {
    documentId: item.file_id,
    page: item.page_number,
    // Internal block ids stay out of the inspector view — page/sheet only.
    location: item.sheet_label ?? `стр. ${item.page_number}`,
    excerpt: item.quote,
    value: "—",
  };
}

/**
 * Выбор пары expected/actual для показа: приоритет — первая пара вердикта,
 * иначе первый член роли со значением. Членов может быть несколько —
 * остальные показываются на вкладке доказательств.
 */
export function pickEvidencePair(detail: ApiFindingDetail): {
  expected: { member: GroupMember; fragment?: EvidenceFragment } | null;
  actual: { member: GroupMember; fragment?: EvidenceFragment } | null;
} {
  const byId = new Map(detail.members.map((m) => [m.extraction_id, m]));
  const pair = detail.verdict?.pairs.find(
    (p) => p.expected_extraction_id || p.actual_extraction_id,
  );

  const resolve = (
    extractionId: string | null | undefined,
    role: "expected" | "actual",
  ) => {
    const member =
      (extractionId ? byId.get(extractionId) : undefined) ??
      detail.members.find((m) => m.role === role && m.value != null) ??
      detail.members.find((m) => m.role === role);
    return member ? { member, fragment: member.evidence[0] } : null;
  };

  return {
    expected: resolve(pair?.expected_extraction_id, "expected"),
    actual: resolve(pair?.actual_extraction_id, "actual"),
  };
}

/**
 * Первая цитата каждой роли из замороженной секционной записи. Результат —
 * только реальные file_id/страницы источников; без extraction_id/rule_id,
 * которые у этого анализа отсутствуют по контракту.
 */
export function sectionEvidencePair(
  section: SectionAnalysisSnapshot | null | undefined,
): {
  expected: { file_id: string; page: number } | null;
  actual: { file_id: string; page: number } | null;
} {
  const pick = (role: SectionEvidence["role"]) => {
    const item =
      section?.evidence.find(
        (entry) => entry.role === role && entry.page_number > 0,
      ) ?? section?.evidence.find((entry) => entry.role === role);
    return item ? { file_id: item.file_id, page: item.page_number } : null;
  };
  return { expected: pick("reference"), actual: pick("actual") };
}

/**
 * Находка списка → модель формы. Без detail используются значения из
 * снимка вердикта (для карточки списка достаточно); с detail подставляются
 * страница, локатор и цитата из выбранной пары.
 */
export function toVerificationFinding(
  item: ApiFinding,
  ordinal: number,
  detail?: ApiFindingDetail,
): VerificationFinding {
  let expected: VerificationEvidence;
  let actual: VerificationEvidence;

  if (detail && detail.id === item.id) {
    const pair = pickEvidencePair(detail);
    expected = evidenceFromMember(
      pair.expected?.member,
      pair.expected?.fragment,
    );
    actual = evidenceFromMember(pair.actual?.member, pair.actual?.fragment);
  } else {
    const expectedRef = item.verdict?.expected?.[0];
    const actualRef = item.verdict?.actual?.[0];
    expected = {
      ...emptyEvidence,
      documentId: expectedRef?.file_id ?? "",
      value: expectedRef ? refValue(expectedRef) : "—",
    };
    actual = {
      ...emptyEvidence,
      documentId: actualRef?.file_id ?? "",
      value: actualRef ? refValue(actualRef) : "—",
    };
    // A gated comparison may have no verdict values despite a real extraction.
    const preview = item.evidence_preview;
    if (preview) {
      const evidence = {
        ...emptyEvidence,
        documentId: preview.file_id,
        excerpt: preview.quote,
        value: refValue(preview),
      };
      if (preview.role === "expected" && !expectedRef) expected = evidence;
      if (preview.role === "actual" && !actualRef) actual = evidence;
    }
  }

  // Секционная запись заполняет только стороны без скалярного доказательства;
  // её цитаты не заменяют извлечённые значения детерминированного сравнения.
  const section =
    detail && detail.id === item.id
      ? (detail.section_analysis ?? item.section_analysis)
      : item.section_analysis;
  if (section) {
    if (!expected.documentId) {
      const reference = section.evidence.find(
        (entry) => entry.role === "reference",
      );
      if (reference) expected = evidenceFromSection(reference);
    }
    if (!actual.documentId) {
      const target = section.evidence.find((entry) => entry.role === "actual");
      if (target) actual = evidenceFromSection(target);
    }
  }

  const context = detail?.context ?? item.verdict?.context;
  const contextLabel = context
    ? `${context.scope || "Область не определена"} · ${context.works_period.from ?? "начало не определено"} — ${context.works_period.to ?? "окончание не определено"}`
    : item.scope_key && item.scope_key !== "object"
      ? `Область: ${item.scope_key}`
      : undefined;
  return {
    id: item.id,
    ordinal,
    title: item.parameter_name
      ? `${item.parameter_code} · ${item.parameter_name}`
      : section?.matrix?.name
        ? `${item.parameter_code} · ${section.matrix.name}`
        : item.parameter_code,
    description: describeFinding(item),
    contextLabel,
    uiMarker: markerForRisk(item.risk),
    findingStatus: item.status,
    reviewPriority: priorityForRisk(item.risk),
    expectedEvidence: expected,
    actualEvidence: actual,
    sourcePreview: item.evidence_preview?.quote,
    decisionReason: labelForRejectionCode(item.reason_code),
    reviewComment: item.comment,
    parameterCode: item.parameter_code,
    verdictStatus: item.verdict?.status,
    findingVersion: item.finding_version,
    statusLabel:
      item.status === "NEGATIVE_VERIFIED" &&
      item.verdict?.status === "match" &&
      !item.decided_at
        ? "Совпадает"
        : undefined,
    source: VERIFICATION_API_SOURCE,
    isSynthetic: false,
  };
}

const stageLabels: Record<string, VerificationDocumentStage> = {
  PD: VerificationDocumentStage.PD,
  RD: VerificationDocumentStage.RD,
  ID: VerificationDocumentStage.ID,
};

/** Документ формы из реального файла объекта (без вымышленных метаданных). */
export function toVerificationDocument(
  file: ParsingFile,
  stage?: string | null,
): VerificationDocument {
  return {
    id: file.file_id,
    title: file.original_name,
    fileName: file.original_name,
    stage: stageLabels[stage ?? ""],
    cipher: "",
    revision: "",
    changeReference: "",
    approvalStatus: "",
    totalPages: file.pages_total ?? 0,
    previewKind: VerificationDocumentPreviewKind.FALLBACK,
    heading: "",
    highlight: "",
    source: VERIFICATION_API_SOURCE,
    isSynthetic: false,
  };
}

/** Действие API для решения формы (целевой статус → глагол). */
export function decisionActionFor(
  findingStatus: FindingStatus,
): "confirm" | "reject" | "clarify" | "reopen" {
  switch (findingStatus) {
    case FindingStatus.CONFIRMED_VIOLATION:
      return "confirm";
    case FindingStatus.NEGATIVE_VERIFIED:
      return "reject";
    case FindingStatus.CLARIFICATION_REQUIRED:
      return "clarify";
    default:
      return "reopen";
  }
}
