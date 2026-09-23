import { mockVerificationPackage } from "@/data/verification";
import {
  FindingStatus,
  type VerificationFinding,
} from "@/pages/verification/types";
import {
  PROTOCOL_FIXTURE_SOURCE,
  type CreateSyntheticProtocolInput,
  type ProtocolRecord,
  type ProtocolViolation,
} from "@/types/protocols";

export const PROTOCOL_FIXTURE_NOTICE =
  "Синтетические данные для демонстрации интерфейса. Протокол не является ответом API, реальным результатом проверки или документом для передачи во внешнюю систему.";

export const mockProtocolViolations = [
  {
    id: "synthetic-demo-violation-01",
    ordinal: 1,
    category: "critical",
    section: "КР",
    parameter: "Класс бетона",
    code: "KR-55",
    pdValue: "B35",
    rdValue: "B25",
    idValue: "B25",
    deviation: "⬇️ Понижение класса",
    inspectorDecision: "Подтверждено",
  },
  {
    id: "synthetic-demo-violation-02",
    ordinal: 2,
    category: "critical",
    section: "АР",
    parameter: "Ширина эвакуационных дверей",
    code: "AR-41",
    pdValue: "1,0 м",
    rdValue: "0,8 м",
    idValue: "0,8 м",
    deviation: "⬇️ Снижение на 0,2 м",
    inspectorDecision: "Подтверждено",
  },
  {
    id: "synthetic-demo-violation-03",
    ordinal: 3,
    category: "critical",
    section: "АР",
    parameter: "Ширина эвакуационных коридоров",
    code: "AR-14",
    pdValue: "1,4 м",
    rdValue: "1,1 м",
    idValue: "1,1 м",
    deviation: "⬇️ Сужение на 0,3 м",
    inspectorDecision: "Подтверждено",
  },
  {
    id: "synthetic-demo-violation-04",
    ordinal: 4,
    category: "critical",
    section: "СПЗУ",
    parameter: "Ширина пожарных проездов",
    code: "СПЗУ-30",
    pdValue: "4,5 м",
    rdValue: "3,8 м",
    idValue: "3,7 м",
    deviation: "⬇️ Сужение на 0,8 м",
    inspectorDecision: "Подтверждено",
  },
  {
    id: "synthetic-demo-violation-05",
    ordinal: 5,
    category: "critical",
    section: "ИОС1",
    parameter: "Сечение питающих кабелей",
    code: "ИОС1-69",
    pdValue: "4×95 мм²",
    rdValue: "4×70 мм²",
    idValue: "4×70 мм²",
    deviation: "⬇️ Занижение сечения",
    inspectorDecision: "Подтверждено",
  },
  {
    id: "synthetic-demo-violation-06",
    ordinal: 6,
    category: "critical",
    section: "ППМ",
    parameter: "Предел огнестойкости дверей",
    code: "ППМ-103",
    pdValue: "EI-60",
    rdValue: "EI-30",
    idValue: "EI-30",
    deviation: "⬇️ Снижение предела",
    inspectorDecision: "Подтверждено",
  },
  {
    id: "synthetic-demo-violation-07",
    ordinal: 7,
    category: "significant",
    section: "СПЗУ",
    parameter: "Площадь асфальтобетонного покрытия",
    code: "СПЗУ-25",
    pdValue: "850 м²",
    rdValue: "720 м²",
    idValue: "715 м²",
    deviation: "⬇️ Уменьшение на 16%",
    inspectorDecision: "Подтверждено",
  },
  {
    id: "synthetic-demo-violation-08",
    ordinal: 8,
    category: "significant",
    section: "КР",
    parameter: "Расход бетона (общий объём)",
    code: "КР-67",
    pdValue: "1560 м³",
    rdValue: "1480 м³",
    idValue: "1440 м³",
    deviation: "⬇️ Экономия 7,7%",
    inspectorDecision: "Подтверждено",
  },
  {
    id: "synthetic-demo-violation-09",
    ordinal: 9,
    category: "significant",
    section: "ПОС",
    parameter: "Срок устройства фундаментов",
    code: "ПОС-82",
    pdValue: "45 дн.",
    rdValue: "62 дн.",
    idValue: "58 дн.",
    deviation: "⬆️ Превышение 29%",
    inspectorDecision: "Подтверждено",
  },
  {
    id: "synthetic-demo-violation-10",
    ordinal: 10,
    category: "significant",
    section: "ПОД",
    parameter: "Объём демонтажа (бетон)",
    code: "ПОД-93",
    pdValue: "320 м³",
    rdValue: "290 м³",
    idValue: "280 м³",
    deviation: "⬇️ Расхождение 12,5%",
    inspectorDecision: "Подтверждено",
  },
  {
    id: "synthetic-demo-violation-11",
    ordinal: 11,
    category: "significant",
    section: "ОДИ",
    parameter: "Тактильные указатели",
    code: "ОДИ-122",
    pdValue: "Предусмотрены",
    rdValue: "Отсутствуют",
    idValue: "Отсутствуют",
    deviation: "❌ Полное отсутствие",
    inspectorDecision: "Подтверждено",
  },
  {
    id: "synthetic-demo-violation-12",
    ordinal: 12,
    category: "significant",
    section: "ЗУ",
    parameter: "Приборы учёта ресурсов",
    code: "ЗУ-129",
    pdValue: "3 узла",
    rdValue: "1 узел",
    idValue: "1 узел",
    deviation: "❌ Отсутствуют 2 узла",
    inspectorDecision: "Подтверждено",
  },
] as const satisfies readonly ProtocolViolation[];

export function areAllFindingsProcessed(
  findings: readonly VerificationFinding[],
): boolean {
  return findings.every(
    (finding) => finding.findingStatus !== FindingStatus.CANDIDATE,
  );
}

function snapshotFinding(finding: VerificationFinding): VerificationFinding {
  return {
    ...finding,
    expectedEvidence: { ...finding.expectedEvidence },
    actualEvidence: { ...finding.actualEvidence },
    consequences: finding.consequences?.slice(),
  };
}

function snapshotViolation(violation: ProtocolViolation): ProtocolViolation {
  return { ...violation };
}

export function createSyntheticProtocol(
  input: CreateSyntheticProtocolInput,
): ProtocolRecord {
  if (!areAllFindingsProcessed(input.findings)) {
    throw new Error(
      "Протокол можно сформировать только после обработки всех расхождений.",
    );
  }

  return {
    id: input.id,
    objectId: input.objectId,
    objectName: input.objectName,
    checkedAt: input.checkedAt,
    findings: input.findings.map(snapshotFinding),
    violations: input.violations.map(snapshotViolation),
    source: PROTOCOL_FIXTURE_SOURCE,
    isSynthetic: true,
    fixtureNotice: PROTOCOL_FIXTURE_NOTICE,
  };
}

const processedFindings = mockVerificationPackage.findings.filter(
  (finding) => finding.findingStatus !== FindingStatus.CANDIDATE,
);

export const mockProtocols = [
  createSyntheticProtocol({
    id: "synthetic-demo-protocol-north-2026-09-18",
    objectId: "synthetic-demo-object-north",
    objectName: "Демонстрационный объект «Северный»",
    checkedAt: "2026-09-18",
    findings: processedFindings.slice(0, 10),
    violations: mockProtocolViolations,
  }),
  createSyntheticProtocol({
    id: "synthetic-demo-protocol-river-2026-09-12",
    objectId: "synthetic-demo-object-river",
    objectName: "Демонстрационный объект «Речной»",
    checkedAt: "2026-09-12",
    findings: processedFindings.slice(6, 14),
    violations: mockProtocolViolations,
  }),
  createSyntheticProtocol({
    id: "synthetic-demo-protocol-north-2026-09-05",
    objectId: "synthetic-demo-object-north",
    objectName: "Демонстрационный объект «Северный»",
    checkedAt: "2026-09-05",
    findings: processedFindings.slice(12),
    violations: mockProtocolViolations,
  }),
] as const satisfies readonly ProtocolRecord[];
