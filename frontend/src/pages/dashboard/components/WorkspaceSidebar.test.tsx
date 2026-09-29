import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { Role, type UserDto } from "@/api/types/auth";
import routeNames from "@/routes/routeNames";

import { MobileNavigation, WorkspaceSidebar } from "./WorkspaceSidebar";

const user: UserDto = {
  createdAt: "2026-09-16T08:00:00.000Z",
  id: "27b43d75-2f24-4ff0-8bd8-d4758cfbd3cb",
  login: "inspector",
  lastName: "Иванов",
  firstName: "Иван",
  role: Role.INSPECTOR,
};
const administrator: UserDto = {
  ...user,
  id: "b1f9bbf4-6eb4-4dc1-9480-88284195640d",
  login: "administrator",
  role: Role.ADMINISTRATOR,
};
const sidebarStorageKey = "inspector-ai:sidebar-collapsed:v1";

interface MatchMediaController {
  setMatches: (query: string, matches: boolean) => void;
}

function installMatchMedia(): MatchMediaController {
  const states = new Map<string, boolean>();
  const listeners = new Map<
    string,
    Set<(event: MediaQueryListEvent) => void>
  >();

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string): MediaQueryList => ({
      addEventListener: (
        _type: string,
        listener: EventListenerOrEventListenerObject,
      ) => {
        const queryListeners = listeners.get(query) ?? new Set();
        if (typeof listener === "function") {
          queryListeners.add(listener);
        }
        listeners.set(query, queryListeners);
      },
      addListener: (listener: (event: MediaQueryListEvent) => void) => {
        const queryListeners = listeners.get(query) ?? new Set();
        queryListeners.add(listener);
        listeners.set(query, queryListeners);
      },
      dispatchEvent: () => true,
      get matches() {
        return states.get(query) ?? false;
      },
      media: query,
      onchange: null,
      removeEventListener: (
        _type: string,
        listener: EventListenerOrEventListenerObject,
      ) => {
        if (typeof listener === "function") {
          listeners.get(query)?.delete(listener);
        }
      },
      removeListener: (listener: (event: MediaQueryListEvent) => void) => {
        listeners.get(query)?.delete(listener);
      },
    }),
    writable: true,
  });

  return {
    setMatches: (query, matches) => {
      states.set(query, matches);
      const event = { matches, media: query } as MediaQueryListEvent;
      listeners.get(query)?.forEach((listener) => {
        listener(event);
      });
    },
  };
}

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function renderSidebar(
  initialEntry: string = routeNames.DOCUMENT_VERIFICATION,
  sidebarUser: UserDto = user,
) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <WorkspaceSidebar
        isLoggingOut={false}
        onLogout={vi.fn()}
        user={sidebarUser}
      />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe("WorkspaceSidebar", () => {
  it("выделяет раздел объектов в карточке и возвращает к списку", () => {
    installMatchMedia();
    renderSidebar(routeNames.OBJECT_UPLOAD("synthetic-id"));
    const objectsButton = screen.getByRole("button", { name: "Объекты" });
    expect(objectsButton).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(objectsButton);
    expect(screen.getByTestId("location")).toHaveTextContent(
      routeNames.OBJECTS,
    );
    fireEvent.click(screen.getByRole("button", { name: "Проверки" }));
    expect(objectsButton).toHaveAttribute("aria-pressed", "false");
  });

  it("выделяет протоколы на странице отдельного протокола", () => {
    installMatchMedia();
    renderSidebar(routeNames.PROTOCOL_DETAILS("synthetic-demo-protocol"));

    const protocolsButton = screen.getByRole("button", {
      name: "Протоколы",
    });
    expect(protocolsButton).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(protocolsButton);
    expect(screen.getByTestId("location")).toHaveTextContent(
      routeNames.PROTOCOLS,
    );
  });

  it("скрывает инспекторские разделы от роли без подтверждённого права", () => {
    installMatchMedia();
    renderSidebar(routeNames.ROOT, administrator);

    expect(
      screen.queryByRole("button", { name: "Проверки" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Протоколы" }),
    ).not.toBeInTheDocument();
  });
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("light", "dark");
    delete document.documentElement.dataset.theme;
  });

  it("сворачивается и разворачивается вручную", () => {
    installMatchMedia();
    renderSidebar();

    const sidebar = screen.getByLabelText("Боковая панель");
    expect(sidebar).toHaveAttribute("data-collapsed", "false");

    fireEvent.click(
      screen.getByRole("button", { name: "Свернуть боковую панель" }),
    );
    expect(sidebar).toHaveAttribute("data-collapsed", "true");

    fireEvent.click(
      screen.getByRole("button", { name: "Развернуть боковую панель" }),
    );
    expect(sidebar).toHaveAttribute("data-collapsed", "false");
  });

  it("восстанавливает ручное состояние после повторного монтирования", () => {
    installMatchMedia();
    const firstRender = renderSidebar();

    fireEvent.click(
      screen.getByRole("button", { name: "Свернуть боковую панель" }),
    );
    expect(window.localStorage.getItem(sidebarStorageKey)).toBe("true");

    firstRender.unmount();
    const secondRender = renderSidebar();
    expect(screen.getByLabelText("Боковая панель")).toHaveAttribute(
      "data-collapsed",
      "true",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Развернуть боковую панель" }),
    );
    expect(window.localStorage.getItem(sidebarStorageKey)).toBeNull();

    secondRender.unmount();
    renderSidebar();
    expect(screen.getByLabelText("Боковая панель")).toHaveAttribute(
      "data-collapsed",
      "false",
    );
  });

  it("автоматически сворачивается при ширине 1280 px и меньше", () => {
    const matchMedia = installMatchMedia();
    renderSidebar();

    const sidebar = screen.getByLabelText("Боковая панель");

    act(() => {
      matchMedia.setMatches("(max-width: 1280px)", true);
    });
    expect(sidebar).toHaveAttribute("data-collapsed", "true");
    expect(window.localStorage.getItem(sidebarStorageKey)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Развернуть боковую панель" }),
    ).toBeDisabled();

    act(() => {
      matchMedia.setMatches("(max-width: 1280px)", false);
    });
    expect(sidebar).toHaveAttribute("data-collapsed", "false");
  });

  it("переходит к загрузке документов и обратно к проверкам", () => {
    installMatchMedia();
    renderSidebar();

    const checksButton = screen.getByRole("button", { name: "Проверки" });
    const uploadButton = screen.getByRole("button", {
      name: "Загрузка комплекта",
    });

    expect(checksButton).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(uploadButton);

    expect(screen.getByTestId("location")).toHaveTextContent(
      routeNames.OBJECTS,
    );
    expect(uploadButton).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(checksButton);

    expect(screen.getByTestId("location")).toHaveTextContent(
      routeNames.DOCUMENT_VERIFICATION,
    );
    expect(checksButton).toHaveAttribute("aria-pressed", "true");
  });

  it("открывает и закрывает мобильную навигацию", async () => {
    installMatchMedia();
    render(
      <MemoryRouter>
        <Routes>
          <Route
            element={
              <MobileNavigation
                isLoggingOut={false}
                onLogout={vi.fn()}
                user={user}
              />
            }
            path="*"
          />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Открыть меню" }));

    expect(
      await screen.findByRole("dialog", { name: "Навигация" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Закрыть меню" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Навигация" }),
      ).not.toBeInTheDocument();
    });
  });

  it("переключает тему из меню пользователя", async () => {
    installMatchMedia();
    renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "Профиль: inspector" }));

    expect(await screen.findByText("Тема оформления")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Тёмная" }));

    expect(document.documentElement).toHaveClass("dark");
    expect(document.documentElement).toHaveAttribute("data-theme", "dark");

    fireEvent.click(screen.getByRole("radio", { name: "Светлая" }));

    expect(document.documentElement).toHaveClass("light");
    expect(document.documentElement).toHaveAttribute("data-theme", "light");
  });
});
