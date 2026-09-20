import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Stepper } from "./Stepper";

const steps = [
  { label: "Файлы", description: "Загрузка документов" },
  { label: "Метаданные", description: "Автоматическое определение" },
  { label: "Запуск", description: "Подготовка анализа" },
] as const;

describe("Stepper", () => {
  it("renders all steps and marks the current one", () => {
    render(
      <Stepper aria-label="Этапы" currentStep={2} steps={steps} />,
    );

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(items[0]).not.toHaveAttribute("aria-current");
    expect(items[2]).not.toHaveAttribute("aria-current");
  });

  it("shows numbers for current and upcoming steps", () => {
    render(<Stepper currentStep={2} steps={steps} />);

    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByText("1")).not.toBeInTheDocument();
  });

  it("calls onStepClick with the step number", async () => {
    const onStepClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Stepper currentStep={1} onStepClick={onStepClick} steps={steps} />,
    );

    await user.click(
      screen.getByRole("button", { name: "Шаг 3: Запуск" }),
    );
    expect(onStepClick).toHaveBeenCalledWith(3);
  });

  it("renders without buttons when not clickable", () => {
    render(<Stepper currentStep={1} steps={steps} />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Метаданные")).toBeInTheDocument();
  });
});
