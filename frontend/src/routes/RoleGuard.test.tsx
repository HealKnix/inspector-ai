import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { Role, type UserDto } from "@/api/types/auth";
import { useAuthSessionStore } from "@/store/auth-session";

import { RoleGuard } from "./RoleGuards";

function renderGuard(roles: Role | readonly Role[], role: Role | null) {
  const user: UserDto = {
    id: "27b43d75-2f24-4ff0-8bd8-d4758cfbd3cb",
    login: "inspector",
    role,
    lastName: "Иванов",
    firstName: "Иван",
    createdAt: "2026-09-16T08:00:00.000Z",
  };

  useAuthSessionStore.setState({ initialized: true, user });

  render(
    <MemoryRouter initialEntries={["/protected"]}>
      <Routes>
        <Route element={<RoleGuard roles={roles} />} path="/protected">
          <Route element={<p>Разрешённый раздел</p>} index />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("RoleGuard", () => {
  it("принимает одну разрешённую роль без массива", () => {
    renderGuard(Role.INSPECTOR, Role.INSPECTOR);

    expect(screen.getByText("Разрешённый раздел")).toBeInTheDocument();
  });

  it("принимает массив разрешённых ролей", () => {
    renderGuard([Role.ADMINISTRATOR, Role.ML_ENGINEER], Role.ML_ENGINEER);

    expect(screen.getByText("Разрешённый раздел")).toBeInTheDocument();
  });

  it("отклоняет роль, которой нет среди разрешённых", () => {
    renderGuard([Role.ADMINISTRATOR, Role.ML_ENGINEER], Role.INSPECTOR);

    expect(screen.getByRole("alert")).toHaveTextContent("Недостаточно прав");
    expect(screen.queryByText("Разрешённый раздел")).not.toBeInTheDocument();
  });
});
