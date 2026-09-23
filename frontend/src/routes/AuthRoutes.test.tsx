import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { Role, type UserDto } from "@/api/types/auth";
import routeNames from "@/routes/routeNames";
import { useAuthSessionStore } from "@/store/auth-session";

import { ProtectedRoute } from "./ProtectedRoute";
import { PublicOnlyRoute } from "./PublicOnlyRoute";

const user: UserDto = {
  id: "27b43d75-2f24-4ff0-8bd8-d4758cfbd3cb",
  login: "inspector",
  lastName: "Иванов",
  firstName: "Иван",
  role: Role.INSPECTOR,
  createdAt: "2026-09-16T08:00:00.000Z",
};

beforeEach(() => {
  useAuthSessionStore.setState({
    accessToken: null,
    initialized: false,
    user: null,
  });
});

function renderProtectedRoute() {
  render(
    <MemoryRouter initialEntries={[routeNames.ROOT]}>
      <Routes>
        <Route element={<p>Страница входа</p>} path={routeNames.LOGIN} />
        <Route element={<ProtectedRoute />} path={routeNames.ROOT}>
          <Route element={<p>Защищённый раздел</p>} index />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function renderPublicOnlyRoute() {
  render(
    <MemoryRouter initialEntries={[routeNames.LOGIN]}>
      <Routes>
        <Route element={<PublicOnlyRoute />} path={routeNames.LOGIN}>
          <Route element={<p>Форма входа</p>} index />
        </Route>
        <Route element={<p>Рабочая область</p>} path={routeNames.ROOT} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("auth routes", () => {
  it("ожидает инициализацию сессии перед защищённым маршрутом", () => {
    renderProtectedRoute();

    expect(screen.getByText("Проверяем сессию…")).toBeInTheDocument();
  });

  it("перенаправляет гостя с защищённого маршрута на вход", () => {
    useAuthSessionStore.setState({ initialized: true });

    renderProtectedRoute();

    expect(screen.getByText("Страница входа")).toBeInTheDocument();
  });

  it("показывает защищённый маршрут авторизованному пользователю", () => {
    useAuthSessionStore.setState({ initialized: true, user });

    renderProtectedRoute();

    expect(screen.getByText("Защищённый раздел")).toBeInTheDocument();
  });

  it("показывает публичный маршрут гостю", () => {
    useAuthSessionStore.setState({ initialized: true });

    renderPublicOnlyRoute();

    expect(screen.getByText("Форма входа")).toBeInTheDocument();
  });

  it("перенаправляет авторизованного пользователя в рабочую область", () => {
    useAuthSessionStore.setState({ initialized: true, user });

    renderPublicOnlyRoute();

    expect(screen.getByText("Рабочая область")).toBeInTheDocument();
  });
});
