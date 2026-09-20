import { act, fireEvent, render, screen } from "@testing-library/react";
import { useParams } from "react-router-dom";

import { Role, type UserDto } from "@/api/types/auth";
import { AppProviders } from "@/components/AppProviders";
import { useAuthSessionStore } from "@/store/auth-session";

import { AppRoutes } from "./AppRoutes";
import routeNames from "./routeNames";

const lazyImports = vi.hoisted(() => {
  const deferred = () => {
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
  };

  return {
    dashboard: deferred(),
    documentUpload: deferred(),
  };
});

vi.mock("@/api/hooks/use-auth", () => ({
  useCurrentUser: () => ({ isError: false, isPending: false }),
  useLogout: () => ({ error: null, isPending: false, mutate: vi.fn() }),
}));

vi.mock("@/pages/dashboard/DashboardPage", async () => {
  await lazyImports.dashboard.promise;

  return {
    DashboardPage: () => <p>Дашборд</p>,
  };
});

vi.mock("@/pages/auth/AuthPage", () => ({
  AuthPage: () => <p>Страница входа</p>,
}));

vi.mock("@/pages/verification/VerificationPage", () => ({
  VerificationPage: () => <p>Проверка комплекта документов</p>,
}));

vi.mock("@/pages/document-upload/DocumentUploadPage", async () => {
  await lazyImports.documentUpload.promise;

  return {
    DocumentUploadPage: () => <p>Загрузка документов</p>,
  };
});
vi.mock("@/pages/objects/ObjectsPage", () => ({
  ObjectsPage: () => <p>Список объектов</p>,
}));
vi.mock("@/pages/object-details/ObjectDetailsPage", () => ({
  ObjectDetailsPage: () => <p>Карточка объекта {useParams().objectId}</p>,
}));

const user: UserDto = {
  id: "27b43d75-2f24-4ff0-8bd8-d4758cfbd3cb",
  login: "inspector",
  role: Role.INSPECTOR,
  createdAt: "2026-09-16T08:00:00.000Z",
};

const administrator: UserDto = {
  ...user,
  id: "b1f9bbf4-6eb4-4dc1-9480-88284195640d",
  login: "administrator",
  role: Role.ADMINISTRATOR,
};

describe("AppRoutes", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it.each([
    [routeNames.OBJECTS, "Список объектов"],
    [
      routeNames.OBJECT_DETAILS("synthetic-id"),
      "Карточка объекта synthetic-id",
    ],
  ])(
    "открывает маршрут объектов %s без подмены dashboard",
    async (path, label) => {
      window.history.replaceState({}, "", path);
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
      expect(await screen.findByText(label)).toBeInTheDocument();
      expect(
        screen.queryByText("Проверка комплекта документов"),
      ).not.toBeInTheDocument();
    },
  );

  it("закрывает прямую ссылку на объект для гостя", async () => {
    window.history.replaceState(
      {},
      "",
      routeNames.OBJECT_DETAILS("synthetic-id"),
    );
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
    expect(
      screen.queryByText("Карточка объекта synthetic-id"),
    ).not.toBeInTheDocument();
  });

  it("не предоставляет раздел верификации роли без подтверждённого права", async () => {
    window.history.replaceState({}, "", routeNames.DOCUMENT_VERIFICATION);
    useAuthSessionStore.setState({
      accessToken: "access-token",
      initialized: true,
      user: administrator,
    });

    render(
      <AppProviders>
        <AppRoutes />
      </AppProviders>,
    );

    expect(await screen.findByText("Недостаточно прав")).toBeInTheDocument();
    expect(
      screen.queryByText("Проверка комплекта документов"),
    ).not.toBeInTheDocument();
  });

  it("сохраняет свёрнутый сайдбар и показывает fallback только в main", async () => {
    window.history.replaceState({}, "", routeNames.DOCUMENT_VERIFICATION);
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

    expect(
      await screen.findByText("Проверка комплекта документов"),
    ).toBeInTheDocument();

    const sidebar = screen.getByLabelText("Боковая панель");
    fireEvent.click(
      screen.getByRole("button", { name: "Свернуть боковую панель" }),
    );
    expect(sidebar).toHaveAttribute("data-collapsed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Загрузка комплекта" }));

    const fallback = await screen.findByText("Загружаем интерфейс…");
    expect(fallback.closest("main")).toBeInTheDocument();
    expect(screen.getByLabelText("Боковая панель")).toBe(sidebar);
    expect(sidebar).toHaveAttribute("data-collapsed", "true");

    lazyImports.documentUpload.resolve();

    expect(await screen.findByText("Загрузка документов")).toBeInTheDocument();
    expect(screen.getByLabelText("Боковая панель")).toBe(sidebar);
    expect(sidebar).toHaveAttribute("data-collapsed", "true");
  });

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

    const fallback = await screen.findByText("Загружаем интерфейс…");
    expect(fallback.closest("main")).toBeInTheDocument();
    expect(screen.getByLabelText("Боковая панель")).toBeInTheDocument();

    lazyImports.dashboard.resolve();

    expect(await screen.findByText("Дашборд")).toBeInTheDocument();
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
