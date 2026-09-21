import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { createUser, getUsers, updateUser } from "@/api/endpoints/users";
import { Role, type UserDto } from "@/api/types/auth";
import { useAuthSessionStore } from "@/store/auth-session";
import { UsersPage } from "./UsersPage";

vi.mock("@/api/endpoints/users", () => ({
  createUser: vi.fn(),
  getUsers: vi.fn(),
  updateUser: vi.fn(),
}));

const admin: UserDto = {
  id: "11111111-1111-4111-8111-111111111111",
  login: "admin",
  role: Role.ADMINISTRATOR,
  lastName: "Администраторов",
  firstName: "Администратор",
  patronymic: null,
  phone: null,
  email: null,
  createdAt: "2026-09-15T12:00:00.000Z",
};

const inspector: UserDto = {
  id: "22222222-2222-4222-8222-222222222222",
  login: "inspector.ivanov",
  role: Role.INSPECTOR,
  lastName: "Иванов",
  firstName: "Иван",
  patronymic: "Иванович",
  phone: "+7 900 123-45-67",
  email: "ivanov@example.ru",
  createdAt: "2026-09-16T12:00:00.000Z",
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <UsersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthSessionStore.getState().setSession("access-token", admin);
  vi.mocked(getUsers).mockResolvedValue([admin, inspector]);
  vi.mocked(createUser).mockResolvedValue(inspector);
  vi.mocked(updateUser).mockResolvedValue(inspector);
});

describe("UsersPage", () => {
  it("показывает список пользователей с ролями и контактами", async () => {
    renderPage();

    expect(
      await screen.findByText("Администраторов Администратор"),
    ).toBeInTheDocument();
    expect(screen.getByText("Иванов Иван Иванович")).toBeInTheDocument();
    expect(screen.getByText("inspector.ivanov")).toBeInTheDocument();
    expect(screen.getByText("+7 900 123-45-67")).toBeInTheDocument();
    expect(screen.getAllByText("Инспектор").length).toBeGreaterThan(0);
  });

  it("фильтрует пользователей по роли", async () => {
    renderPage();
    await screen.findByText("Иванов Иван Иванович");

    fireEvent.click(screen.getByRole("button", { name: "Администратор" }));

    expect(screen.queryByText("Иванов Иван Иванович")).not.toBeInTheDocument();
    expect(
      screen.getByText("Администраторов Администратор"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Все роли" }));
    expect(screen.getByText("Иванов Иван Иванович")).toBeInTheDocument();
  });

  it("ищет пользователей по имени, логину и контактам", async () => {
    renderPage();
    await screen.findByText("Иванов Иван Иванович");

    fireEvent.change(screen.getByPlaceholderText("Имя, логин или контакты…"), {
      target: { value: "ivanov" },
    });

    expect(
      screen.queryByText("Администраторов Администратор"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Иванов Иван Иванович")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Имя, логин или контакты…"), {
      target: { value: "ivanov@example.ru" },
    });
    expect(screen.getByText("Иванов Иван Иванович")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Имя, логин или контакты…"), {
      target: { value: "" },
    });
    expect(
      screen.getByText("Администраторов Администратор"),
    ).toBeInTheDocument();
  });

  it("создаёт пользователя через drawer", async () => {
    renderPage();
    await screen.findByText("Иванов Иван Иванович");

    fireEvent.click(
      screen.getByRole("button", { name: "Создать пользователя" }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName("Новый пользователь");

    fireEvent.change(screen.getByLabelText("Логин"), {
      target: { value: "new.user" },
    });
    fireEvent.change(screen.getByLabelText("Фамилия"), {
      target: { value: "Петров" },
    });
    fireEvent.change(screen.getByLabelText("Имя"), {
      target: { value: "Пётр" },
    });
    fireEvent.change(screen.getByLabelText("Пароль"), {
      target: { value: "correct-horse-2026" },
    });
    fireEvent.change(screen.getByLabelText("Повторите пароль"), {
      target: { value: "correct-horse-2026" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Создать пользователя" }),
    );

    await waitFor(() => {
      expect(createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          login: "new.user",
          password: "correct-horse-2026",
          lastName: "Петров",
          firstName: "Пётр",
          role: "INSPECTOR",
        }),
        expect.anything(),
      );
    });
  });

  it("редактирует пользователя через drawer", async () => {
    renderPage();
    await screen.findByText("Иванов Иван Иванович");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Действия с пользователем inspector.ivanov",
      }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Изменить" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAccessibleName("Редактирование пользователя");

    const firstNameInput = screen.getByLabelText("Имя");
    expect(firstNameInput).toHaveValue("Иван");

    fireEvent.change(firstNameInput, { target: { value: "Пётр" } });
    fireEvent.change(screen.getByLabelText("Номер телефона"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => {
      expect(updateUser).toHaveBeenCalledWith(inspector.id, {
        lastName: "Иванов",
        firstName: "Пётр",
        patronymic: "Иванович",
        phone: null,
        email: "ivanov@example.ru",
        role: "INSPECTOR",
      });
    });
  });

  it("не даёт администратору менять собственную роль", async () => {
    renderPage();
    await screen.findByText("Администраторов Администратор");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Действия с пользователем admin",
      }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Изменить" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector('[data-disabled="true"]')).not.toBeNull();
  });
});
