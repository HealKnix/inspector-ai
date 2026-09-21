import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Input } from "./Input";

describe("Input", () => {
  it("renders label and input and accepts typing", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();

    render(<Input label="Логин" name="login" onChange={onChange} />);

    const input = screen.getByRole("textbox", { name: "Логин" });
    expect(input).toHaveAttribute("name", "login");

    await user.type(input, "admin");
    expect(input).toHaveValue("admin");
    expect(onChange).toHaveBeenCalled();
  });

  it("renders an input without a visible label via aria-label", () => {
    render(<Input aria-label="Поиск" placeholder="Найти" type="search" />);

    expect(
      screen.getByRole("searchbox", { name: "Поиск" }),
    ).toBeInTheDocument();
  });

  it("renders description when there is no error", () => {
    render(<Input description="Не менее 12 символов" label="Пароль" />);

    expect(screen.getByText("Не менее 12 символов")).toBeInTheDocument();
  });

  it("renders the error message and hides the description", () => {
    render(
      <Input
        description="Не менее 12 символов"
        errorMessage="Обязательное поле"
        isInvalid
        label="Пароль"
      />,
    );

    expect(screen.getByText("Обязательное поле")).toBeInTheDocument();
    expect(screen.queryByText("Не менее 12 символов")).not.toBeInTheDocument();
  });

  it("marks the field invalid when errorMessage is set", () => {
    render(<Input errorMessage="Ошибка" label="Логин" />);

    expect(screen.getByRole("textbox", { name: "Логин" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("renders start and end content inside the field", () => {
    render(
      <Input
        endContent={<span data-testid="suffix">₽</span>}
        label="Сумма"
        startContent={<span data-testid="prefix">Итого:</span>}
      />,
    );

    expect(screen.getByTestId("prefix")).toBeInTheDocument();
    expect(screen.getByTestId("suffix")).toBeInTheDocument();
  });

  it("focuses the input when the group area is clicked", async () => {
    const user = userEvent.setup();

    render(
      <Input
        label="Поиск"
        startContent={<span data-testid="prefix">⌕</span>}
      />,
    );

    await user.click(screen.getByTestId("prefix"));
    expect(screen.getByRole("textbox", { name: "Поиск" })).toHaveFocus();
  });

  it("respects read-only state", () => {
    render(<Input isReadOnly label="Логин" value="inspector" />);

    expect(screen.getByRole("textbox", { name: "Логин" })).toHaveAttribute(
      "readonly",
    );
  });
});
