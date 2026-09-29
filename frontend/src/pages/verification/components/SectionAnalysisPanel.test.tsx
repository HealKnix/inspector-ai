import { fireEvent, render, screen } from "@testing-library/react";

import type { SectionAnalysisStatus } from "@/api/types/section-analysis";
import {
  sectionStatus,
  sectionTask,
} from "@/api/types/section-analysis-test-fixtures";
import {
  SectionAnalysisPanel,
  type SectionAnalysisPanelProps,
} from "./SectionAnalysisPanel";

const defaults: SectionAnalysisPanelProps = {
  canStart: true,
  onRetryStatus: vi.fn(),
  onStart: vi.fn(),
  staleResults: false,
  startBlockedReason: null,
  startError: null,
  starting: false,
  status: sectionStatus,
  statusError: null,
  statusLoading: false,
};

function mount(overrides: Partial<SectionAnalysisPanelProps> = {}) {
  return render(<SectionAnalysisPanel {...defaults} {...overrides} />);
}

describe("SectionAnalysisPanel", () => {
  it("renders nothing while the feature is disabled without a task", () => {
    const { container } = mount({
      status: { ...sectionStatus, enabled: false, task: null, results: null },
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps a stored task visible after the feature turns off", () => {
    mount({ status: { ...sectionStatus, enabled: false } });
    expect(screen.getByText("Завершён")).toBeTruthy();
    expect(
      screen.getByText(/отключён настройками сервиса/, { exact: false }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Запустить/ })).toBeNull();
  });

  it("starts analysis on an explicit action with a fresh request", () => {
    const onStart = vi.fn();
    mount({
      onStart,
      status: { ...sectionStatus, task: null, results: null },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Запустить анализ разделов" }),
    );
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("explains why start is unavailable without offering a dead button", () => {
    mount({
      canStart: false,
      startBlockedReason:
        "Анализ разделов доступен только для актуального запуска обработки.",
      status: { ...sectionStatus, task: null, results: null },
    });
    expect(
      screen.getByText(/только для актуального запуска/, { exact: false }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Запустить/ })).toBeNull();
  });

  it.each(["queued", "processing"] as const)(
    "shows %s progress without a start button",
    (state) => {
      mount({
        canStart: false,
        status: {
          ...sectionStatus,
          active: true,
          task: { ...sectionTask, state },
          results: null,
        },
      });
      expect(screen.getByRole("status")).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Запустить/ })).toBeNull();
    },
  );

  it("describes a failed task honestly and offers an explicit retry", () => {
    const onStart = vi.fn();
    mount({
      onStart,
      status: {
        ...sectionStatus,
        task: { ...sectionTask, state: "failed", error_code: "x" },
        results: null,
      },
    });
    expect(screen.getByText(/не пригоден для выводов/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Запустить заново" }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("summarises succeeded results without implying a decision", () => {
    mount();
    expect(screen.getByText("Завершён")).toBeTruthy();
    expect(screen.getByText("Областей сравнения")).toBeTruthy();
    expect(screen.getByText("Параметров с ответом")).toBeTruthy();
    // Повторный запуск над актуальным результатом вернул бы только кэш.
    expect(
      screen.queryByRole("button", { name: "Запустить заново" }),
    ).toBeNull();
  });

  it("marks a stale result unusable and offers a real rerun", () => {
    const onStart = vi.fn();
    mount({
      onStart,
      status: {
        ...sectionStatus,
        task: { ...sectionTask, stale: true },
      },
    });
    expect(screen.getByText("Устарел")).toBeTruthy();
    expect(screen.getByText(/не может служить основанием/)).toBeTruthy();
    expect(screen.queryByText("Областей сравнения")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Запустить заново" }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("warns when results are newer than the shown protocol", () => {
    mount({ staleResults: true });
    expect(screen.getByRole("alert").textContent).toContain(
      "Сформируйте протокол заново",
    );
  });

  it("marks partial coverage as incomplete instead of hiding it", () => {
    const status: SectionAnalysisStatus = {
      ...sectionStatus,
      results: {
        ...sectionStatus.results!,
        contexts: sectionStatus.results!.contexts.map((context) => ({
          ...context,
          coverage: { complete: false, missing: ["block_omitted:s:1"] },
        })),
      },
    };
    mount({ status });
    expect(screen.getByText(/проверен не полностью/)).toBeTruthy();
  });

  it("shows load and error states with a retry action", () => {
    const onRetryStatus = vi.fn();
    mount({ onRetryStatus, status: undefined, statusLoading: true });
    expect(screen.getByRole("status")).toBeTruthy();
    mount({
      onRetryStatus,
      status: undefined,
      statusError: "Не удалось получить состояние анализа разделов.",
    });
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(onRetryStatus).toHaveBeenCalledTimes(1);
  });

  it("surfaces the admission error returned by the server", () => {
    mount({ startError: "Секционный анализ отключён конфигурацией" });
    expect(screen.getByRole("alert").textContent).toContain(
      "Секционный анализ отключён конфигурацией",
    );
  });
});
