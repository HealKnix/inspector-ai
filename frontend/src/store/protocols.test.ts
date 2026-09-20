import { mockProtocols, mockProtocolViolations } from "@/data/protocols";
import { mockVerificationPackage } from "@/data/verification";
import { FindingStatus } from "@/pages/verification/types";

import { useProtocolStore } from "./protocols";

const processedFindings = mockVerificationPackage.findings.filter(
  (finding) => finding.findingStatus !== FindingStatus.CANDIDATE,
);

beforeEach(() => {
  window.localStorage.clear();
  useProtocolStore.setState({ protocols: [...mockProtocols] });
});

describe("protocol store", () => {
  it("инициализируется seeded protocols в памяти", () => {
    expect(useProtocolStore.getState().protocols).toEqual(mockProtocols);
    expect(window.localStorage).toHaveLength(0);
  });

  it("создаёт протокол и добавляет его в начало списка", () => {
    const protocol = useProtocolStore.getState().createProtocol({
      objectId: "synthetic-demo-object-created",
      objectName: "Демонстрационный создаваемый объект",
      checkedAt: "2026-09-20",
      findings: processedFindings,
      violations: mockProtocolViolations,
    });

    expect(protocol.id).toBe("synthetic-demo-created-protocol-1");
    expect(protocol.findings).toHaveLength(processedFindings.length);
    expect(protocol.violations).toEqual(mockProtocolViolations);
    expect(protocol.violations).not.toBe(mockProtocolViolations);
    expect(protocol.violations[0]).not.toBe(mockProtocolViolations[0]);
    expect(useProtocolStore.getState().protocols).toEqual([
      protocol,
      ...mockProtocols,
    ]);
    expect(window.localStorage).toHaveLength(0);
  });

  it("создаёт уникальные последовательные идентификаторы", () => {
    const createProtocol = useProtocolStore.getState().createProtocol;
    const input = {
      objectId: "synthetic-demo-object-created",
      objectName: "Демонстрационный создаваемый объект",
      checkedAt: "2026-09-20",
      findings: processedFindings,
      violations: mockProtocolViolations,
    };

    const first = createProtocol(input);
    const second = createProtocol(input);

    expect(first.id).toBe("synthetic-demo-created-protocol-1");
    expect(second.id).toBe("synthetic-demo-created-protocol-2");
  });

  it("не изменяет список, если осталось необработанное расхождение", () => {
    const protocolsBefore = useProtocolStore.getState().protocols;

    expect(() =>
      useProtocolStore.getState().createProtocol({
        objectId: "synthetic-demo-object-created",
        objectName: "Демонстрационный создаваемый объект",
        checkedAt: "2026-09-20",
        findings: mockVerificationPackage.findings,
        violations: mockProtocolViolations,
      }),
    ).toThrow(
      "Протокол можно сформировать только после обработки всех расхождений.",
    );
    expect(useProtocolStore.getState().protocols).toBe(protocolsBefore);
  });
});
