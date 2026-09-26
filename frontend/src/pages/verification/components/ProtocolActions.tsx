import { Button, Modal } from "@heroui/react";
import { useState } from "react";

import type { ProtocolResponse } from "@/api/types/verification";

import { protocolIsCurrent } from "../lib/protocol-lifecycle";

export function ProtocolActions({
  response,
  loading,
  candidateCount,
  findingCount,
  visibleCandidateCount,
  findingsReady,
  busy,
  onGenerate,
  onFinalize,
}: {
  response: ProtocolResponse | undefined;
  loading: boolean;
  candidateCount: number;
  findingCount?: number;
  visibleCandidateCount?: number;
  findingsReady: boolean;
  busy: boolean;
  onGenerate: () => Promise<unknown>;
  onFinalize: () => Promise<unknown>;
}) {
  const [confirming, setConfirming] = useState(false);
  const protocol = response?.protocol;
  const current = protocolIsCurrent(response);
  const finalized =
    response?.process_status === "FINALIZED" ||
    protocol?.status === "finalized";
  const processing = response?.process_status === "PARSING";
  const processLabels: Record<string, string> = {
    PENDING: "Ожидает обработки",
    PARSING: "Документы обрабатываются",
    READY: "Готов к проверке",
    VERIFYING: "На проверке",
    COMPLETED: "Проверка завершена",
    FINALIZED: "Финализирован",
  };
  const canFinalize =
    Boolean(protocol) &&
    current &&
    findingsReady &&
    candidateCount === 0 &&
    !finalized &&
    ["READY", "VERIFYING", "COMPLETED"].includes(
      response?.process_status ?? "",
    );
  const label = loading
    ? "Загружаем протокол…"
    : protocol
      ? `Протокол №${protocol.version} · ${finalized ? "Финализирован" : current ? (processLabels[response?.process_status ?? ""] ?? "Состояние уточняется") : "Предыдущая версия"} · без решения: ${visibleCandidateCount ?? candidateCount}.`
      : "Протокол ещё не сформирован.";
  return (
    <div className="flex flex-col gap-3 sm:items-end">
      <p className="text-copy-muted text-xs leading-5" role="status">
        {label}
      </p>
      {protocol ? (
        <p className="text-copy-muted text-xs">
          Находок: {findingCount ?? protocol.findings}
          {typeof protocol.parameters === "number" &&
          typeof protocol.parameters_compared === "number"
            ? ` · Параметров проверено: ${protocol.parameters_compared} из ${protocol.parameters}`
            : ""}
        </p>
      ) : null}
      {!loading && !finalized && (!protocol || !current) ? (
        <Button
          isDisabled={busy || processing || !response}
          onPress={() => void onGenerate()}
        >
          {protocol ? "Пересобрать протокол" : "Сформировать протокол"}
        </Button>
      ) : null}
      {protocol && !finalized && current ? (
        <Button
          isDisabled={!canFinalize || busy}
          onPress={() => setConfirming(true)}
        >
          Финализировать протокол
        </Button>
      ) : null}
      {protocol && !current ? (
        <p className="text-warning text-xs">
          Состав документов изменился. Решения доступны после пересборки
          протокола.
        </p>
      ) : null}
      <Modal.Backdrop isOpen={confirming} onOpenChange={setConfirming}>
        <Modal.Container>
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>Финализировать протокол?</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <p>
                После финализации загрузка документов и изменение решений будут
                заблокированы. Проверьте, что рассматриваете результат текущего
                запуска.
              </p>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onPress={() => setConfirming(false)}>
                Вернуться
              </Button>
              <Button
                isDisabled={!canFinalize || busy}
                onPress={() => {
                  setConfirming(false);
                  void onFinalize();
                }}
              >
                Подтвердить финализацию
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </div>
  );
}
