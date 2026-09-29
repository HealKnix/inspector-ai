import type { ProtocolResponse } from "@/api/types/verification";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProtocolActions } from "./ProtocolActions";

const response: ProtocolResponse = {
  schema_version: 1,
  object_id: "11111111-1111-4111-8111-111111111111",
  process_status: "COMPLETED",
  current_run_id: "22222222-2222-4222-8222-222222222222",
  is_current: true,
  protocol: {
    id: "33333333-3333-4333-8333-333333333333",
    version: 1,
    status: "active",
    scenario: "FULL",
    created_at: "2026-09-20T00:00:00Z",
    finalized_at: null,
    findings: 1,
    run_id: "22222222-2222-4222-8222-222222222222",
    is_current: true,
  },
  versions: [],
  protocol_absent_reason: null,
};
function mount(value: ProtocolResponse, findingsReady = true) {
  const onGenerate = vi.fn(() => Promise.resolve(undefined)),
    onFinalize = vi.fn(() => Promise.resolve(undefined));
  render(
    <ProtocolActions
      response={value}
      loading={false}
      candidateCount={0}
      findingsReady={findingsReady}
      busy={false}
      onGenerate={onGenerate}
      onFinalize={onFinalize}
    />,
  );
  return { onGenerate, onFinalize };
}
it("keeps finalized protocol visible without presenting generation or write actions", () => {
  mount({
    ...response,
    process_status: "FINALIZED",
    protocol: { ...response.protocol!, status: "finalized" },
  });
  expect(screen.getByRole("status")).toHaveTextContent("Финализирован");
  expect(
    screen.queryByRole("button", {
      name: /Сформировать|Пересобрать|Финализировать/,
    }),
  ).not.toBeInTheDocument();
});
it("offers regeneration of a stale protocol and never finalization of that run", () => {
  const { onGenerate } = mount({
    ...response,
    process_status: "PENDING",
    is_current: false,
  });
  fireEvent.click(screen.getByRole("button", { name: "Пересобрать протокол" }));
  expect(onGenerate).toHaveBeenCalledOnce();
  expect(
    screen.queryByRole("button", { name: "Финализировать протокол" }),
  ).not.toBeInTheDocument();
});
it("requires loaded findings and an explicit confirmation before finalization", () => {
  const { onFinalize } = mount(response);
  fireEvent.click(
    screen.getByRole("button", { name: "Финализировать протокол" }),
  );
  expect(onFinalize).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Подтвердить финализацию" }),
  );
  expect(onFinalize).toHaveBeenCalledOnce();
});
it("does not interpret missing findings as zero undecided candidates", () => {
  mount(response, false);
  expect(
    screen.getByRole("button", { name: "Финализировать протокол" }),
  ).toBeDisabled();
});
it("shows finding count independently from frozen parameter coverage", () => {
  mount({
    ...response,
    protocol: {
      ...response.protocol!,
      findings: 8,
      parameters: 132,
      parameters_compared: 3,
    },
  });
  expect(
    screen.getByText("Находок: 8 · Параметров проверено: 3 из 132"),
  ).toBeInTheDocument();
});
it("uses a readable lifecycle label without changing finalization controls", () => {
  mount({ ...response, process_status: "READY" });
  expect(screen.getByRole("status")).toHaveTextContent("Готов к проверке");
  expect(screen.getByRole("status")).not.toHaveTextContent("READY");
  expect(
    screen.getByRole("button", { name: "Финализировать протокол" }),
  ).toBeEnabled();
});
