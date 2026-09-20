import { mockVerificationPackage } from "@/data/verification";
import { FindingStatus } from "@/pages/verification/types";
import { PROTOCOL_FIXTURE_SOURCE } from "@/types/protocols";

import {
  areAllFindingsProcessed,
  createSyntheticProtocol,
  mockProtocols,
  mockProtocolViolations,
  PROTOCOL_FIXTURE_NOTICE,
} from "./protocols";

describe("mock protocols", () => {
  it("содержит уникальные синтетические протоколы только с объектом и датой", () => {
    const ids = mockProtocols.map((protocol) => protocol.id);

    expect(mockProtocols).toHaveLength(3);
    expect(new Set(ids)).toHaveLength(mockProtocols.length);
    expect(
      new Set(mockProtocols.map((protocol) => protocol.objectId)).size,
    ).toBeGreaterThan(1);
    expect(mockProtocols).toSatisfy((protocols: typeof mockProtocols) =>
      protocols.every(
        (protocol) =>
          protocol.source === PROTOCOL_FIXTURE_SOURCE &&
          protocol.isSynthetic &&
          protocol.fixtureNotice === PROTOCOL_FIXTURE_NOTICE &&
          /^\d{4}-\d{2}-\d{2}$/.test(protocol.checkedAt) &&
          protocol.objectId.length > 0 &&
          protocol.objectName.length > 0,
      ),
    );
  });

  it("не включает необработанные расхождения в seeded protocols", () => {
    expect(mockProtocols).toSatisfy((protocols: typeof mockProtocols) =>
      protocols.every(
        (protocol) =>
          protocol.findings.length > 0 &&
          areAllFindingsProcessed(protocol.findings),
      ),
    );
  });

  it("содержит 6 критических и 6 существенных нарушений", () => {
    expect(mockProtocolViolations).toHaveLength(12);
    expect(
      mockProtocolViolations.filter(
        (violation) => violation.category === "critical",
      ),
    ).toHaveLength(6);
    expect(
      mockProtocolViolations.filter(
        (violation) => violation.category === "significant",
      ),
    ).toHaveLength(6);
    expect(mockProtocolViolations.map(({ ordinal }) => ordinal)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    );
    expect(mockProtocolViolations[0]).toMatchObject({
      code: "KR-55",
      pdValue: "B35",
      rdValue: "B25",
      idValue: "B25",
      deviation: "⬇️ Понижение класса",
      inspectorDecision: "Подтверждено",
    });
    expect(mockProtocolViolations[11]).toMatchObject({
      code: "ЗУ-129",
      pdValue: "3 узла",
      rdValue: "1 узел",
      idValue: "1 узел",
      deviation: "❌ Отсутствуют 2 узла",
      inspectorDecision: "Подтверждено",
    });
    expect(mockProtocols).toSatisfy((protocols: typeof mockProtocols) =>
      protocols.every(
        (protocol) =>
          protocol.violations.length === 12 &&
          protocol.violations !== mockProtocolViolations &&
          protocol.violations[0] !== mockProtocolViolations[0],
      ),
    );
  });

  it("создаёт независимый снимок обработанных расхождений", () => {
    const processedFinding = mockVerificationPackage.findings.find(
      (finding) => finding.findingStatus !== FindingStatus.CANDIDATE,
    );
    expect(processedFinding).toBeDefined();

    const protocol = createSyntheticProtocol({
      id: "synthetic-demo-protocol-test",
      objectId: "synthetic-demo-object-test",
      objectName: "Демонстрационный объект",
      checkedAt: "2026-09-20",
      findings: processedFinding ? [processedFinding] : [],
      violations: mockProtocolViolations,
    });

    expect(protocol).toMatchObject({
      id: "synthetic-demo-protocol-test",
      objectId: "synthetic-demo-object-test",
      objectName: "Демонстрационный объект",
      checkedAt: "2026-09-20",
      source: PROTOCOL_FIXTURE_SOURCE,
      isSynthetic: true,
    });
    expect(protocol.findings[0]).toEqual(processedFinding);
    expect(protocol.findings[0]).not.toBe(processedFinding);
    expect(protocol.findings[0]?.expectedEvidence).not.toBe(
      processedFinding?.expectedEvidence,
    );
    expect(protocol.findings[0]?.actualEvidence).not.toBe(
      processedFinding?.actualEvidence,
    );
    expect(protocol.findings[0]?.consequences).not.toBe(
      processedFinding?.consequences,
    );
    expect(protocol.violations).toEqual(mockProtocolViolations);
    expect(protocol.violations).not.toBe(mockProtocolViolations);
    expect(protocol.violations[0]).not.toBe(mockProtocolViolations[0]);
  });

  it("отклоняет создание до обработки всех расхождений", () => {
    expect(areAllFindingsProcessed(mockVerificationPackage.findings)).toBe(
      false,
    );
    expect(() =>
      createSyntheticProtocol({
        id: "synthetic-demo-protocol-incomplete",
        objectId: "synthetic-demo-object-test",
        objectName: "Демонстрационный объект",
        checkedAt: "2026-09-20",
        findings: mockVerificationPackage.findings,
        violations: mockProtocolViolations,
      }),
    ).toThrow(
      "Протокол можно сформировать только после обработки всех расхождений.",
    );
  });
});
