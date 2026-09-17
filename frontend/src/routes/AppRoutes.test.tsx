import { act, render, screen } from "@testing-library/react";
import { Outlet } from "react-router-dom";

import { Role, type UserDto } from "@/api/types/auth";
import { AppProviders } from "@/components/AppProviders";
import { useAuthSessionStore } from "@/store/auth-session";

import { AppRoutes } from "./AppRoutes";
import routeNames from "./routeNames";

const dashboardImport = vi.hoisted(() => {
  let resolveImport: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolveImport = resolve;
  });

  return {
    promise,
    resolve: () => {
      resolveImport?.();
    },
  };
});

vi.mock("@/api/hooks/use-auth", () => ({
  useCurrentUser: () => ({ isError: false, isPending: false }),
}));

vi.mock("@/pages/auth/AuthPage", () => ({
  AuthPage: () => <p>Страница входа</p>,
}));

vi.mock("@/pages/dashboard/DashboardPage", async () => {
  await dashboardImport.promise;

  return {
    DashboardPage: () => <p>Рабочая область</p>,
  };
});

vi.mock("@/pages/document-upload/DocumentUploadPage", () => ({
  DocumentUploadPage: () => <p>Загрузка документов</p>,
}));

vi.mock("@/layouts/WorkspaceLayout", () => ({
  WorkspaceLayout: () => <Outlet />,
}));

const user: UserDto = {
  id: "27b43d75-2f24-4ff0-8bd8-d4758cfbd3cb",
  login: "inspector",
  role: Role.INSPECTOR,
  createdAt: "2026-09-16T08:00:00.000Z",
};

describe("AppRoutes", () => {
  it("показывает Suspense fallback при переходе на отложенный маршрут", async () => {
    window.history.replaceState({}, "", routeNames.LOGIN);
    useAuthSessionStore.setState({
      accessToken: null,
      initialized: true,
      user: null,
    });

    render(
      <AppProviders>
        <AppRoutes />
      </AppProviders>,
    );

    expect(await screen.findByText("Страница входа")).toBeInTheDocument();

    act(() => {
      useAuthSessionStore.getState().setSession("access-token", user);
    });

    expect(await screen.findByText("Загружаем интерфейс…")).toBeInTheDocument();

    dashboardImport.resolve();

    expect(await screen.findByText("Рабочая область")).toBeInTheDocument();
  });

  it("открывает защищённую страницу загрузки по прямой ссылке", async () => {
    window.history.replaceState({}, "", routeNames.DOCUMENT_UPLOAD);
    useAuthSessionStore.setState({
      accessToken: "access-token",
      initialized: true,
      user,
    });

    render(
      <AppProviders>
        <AppRoutes />
      </AppProviders>,
    );

    expect(await screen.findByText("Загрузка документов")).toBeInTheDocument();
  });
});
