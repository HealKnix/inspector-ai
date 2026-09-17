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
  role: Role.INSPECTOR,
};

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

function renderSidebar(initialEntry = routeNames.APP) {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <WorkspaceSidebar isLoggingOut={false} onLogout={vi.fn()} user={user} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe("WorkspaceSidebar", () => {
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

  it("автоматически сворачивается при ширине 1280 px и меньше", () => {
    const matchMedia = installMatchMedia();
    renderSidebar();

    const sidebar = screen.getByLabelText("Боковая панель");

    act(() => {
      matchMedia.setMatches("(max-width: 1280px)", true);
    });
    expect(sidebar).toHaveAttribute("data-collapsed", "true");
    expect(
      screen.getByRole("button", { name: "Развернуть боковую панель" }),
    ).toBeDisabled();

    act(() => {
      matchMedia.setMatches("(max-width: 1280px)", false);
    });
    expect(sidebar).toHaveAttribute("data-collapsed", "false");
  });

  it("показывает Popover с круглосуточной доступностью", async () => {
    installMatchMedia();
    renderSidebar();

    fireEvent.click(screen.getByRole("button", { name: "Статус системы" }));

    expect(
      await screen.findByText("Система работает штатно"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Сервис доступен круглосуточно, 24/7"),
    ).toBeInTheDocument();
    expect(screen.getByText("Онлайн")).toBeInTheDocument();
  });

  it("переходит к загрузке документов и обратно к проверкам", () => {
    installMatchMedia();
    renderSidebar();

    const checksButton = screen.getByRole("button", { name: "Проверки" });
    const createButton = screen.getByRole("button", { name: "Создать" });

    expect(checksButton).toHaveAttribute("aria-pressed", "true");

    const searchButton = screen.getByRole("button", { name: "Поиск" });
    fireEvent.click(searchButton);

    expect(searchButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("location")).toHaveTextContent(routeNames.APP);

    fireEvent.click(createButton);

    expect(screen.getByTestId("location")).toHaveTextContent(
      routeNames.DOCUMENT_UPLOAD,
    );
    expect(createButton).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(checksButton);

    expect(screen.getByTestId("location")).toHaveTextContent(routeNames.APP);
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
