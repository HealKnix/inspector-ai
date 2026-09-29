import {
  Avatar,
  Button,
  Drawer,
  Popover,
  ScrollShadow,
  Tooltip,
  useMediaQuery,
  useOverlayState,
} from "@heroui/react";
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { Role, roleLabels, type UserDto } from "@/api/types/auth";
import { BrandMark } from "@/components/BrandMark";

import { LogoutConfirmationDialog } from "@/components/LogoutConfirmationDialog";
import { fallbackAvatars } from "@/lib/fallback-avatars";
import { cn } from "@/lib/utils";
import routeNames from "@/routes/routeNames";
import { DashboardIcon, type DashboardIconName } from "./DashboardIcon";

import { ThemeSwitcher } from "./ThemeSwitcher";

const SIDEBAR_COLLAPSED_STORAGE_KEY = "inspector-ai:sidebar-collapsed:v1";

function getStoredSidebarCollapsed() {
  if (typeof window === "undefined") return false;

  try {
    const storedValue = window.localStorage.getItem(
      SIDEBAR_COLLAPSED_STORAGE_KEY,
    );

    if (storedValue === "true") return true;
    if (storedValue !== null) {
      window.localStorage.removeItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
    }
  } catch {
    return false;
  }

  return false;
}

function saveSidebarCollapsed(collapsed: boolean) {
  if (typeof window === "undefined") return;

  try {
    if (collapsed) {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, "true");
    } else {
      window.localStorage.removeItem(SIDEBAR_COLLAPSED_STORAGE_KEY);
    }
  } catch {
    // The sidebar still keeps its state for the current page session.
  }
}

interface NavigationItem {
  href: string;
  icon: DashboardIconName;
  label: string;
  roles?: readonly Role[];
}

const primaryItems: readonly NavigationItem[] = [
  { href: routeNames.OBJECTS, icon: "folder", label: "Объекты" },
  {
    href: routeNames.OBJECTS,
    icon: "upload",
    label: "Загрузка комплекта",
    roles: [Role.INSPECTOR],
  },
  {
    href: routeNames.DOCUMENT_VERIFICATION,
    icon: "lightning",
    label: "Проверки",
    roles: [Role.INSPECTOR],
  },
  {
    href: routeNames.PROTOCOLS,
    icon: "file",
    label: "Протоколы",
    roles: [Role.INSPECTOR],
  },
  {
    href: routeNames.ADMIN_USERS,
    icon: "user",
    label: "Пользователи",
    roles: [Role.ADMINISTRATOR],
  },
  {
    href: routeNames.ADMIN_DOCUMENTS,
    icon: "file",
    label: "Документы",
    roles: [Role.ADMINISTRATOR],
  },
];

const secondaryItems: readonly NavigationItem[] = [];

interface SidebarSharedProps {
  isLoggingOut: boolean;
  logoutError?: string;
  onLogout: () => void;
  user: UserDto | null;
}

interface NavigationListProps {
  activeHref: string | null;
  collapsed: boolean;
  items: readonly NavigationItem[];
  className?: string;
  onActiveHrefChange: (item: string) => void;
}

function NavigationList({
  activeHref,
  collapsed,
  items,
  className,
  onActiveHrefChange,
}: NavigationListProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {items.map((item) => {
        const isActive =
          item.href.split("/").at(1) === activeHref?.split("/").at(1);

        return (
          <Tooltip key={`${item.href}:${item.label}`} isDisabled={!collapsed}>
            <Button
              aria-label={collapsed ? item.label : undefined}
              aria-pressed={isActive}
              className={cn(
                "h-11 w-full justify-start gap-3 overflow-hidden rounded-[14px] px-3.75 shadow-none",
                "before:bg-primary before:absolute before:left-0 before:h-[18px] before:w-0.5 before:scale-y-[0.3] before:rounded-full before:opacity-0 before:transition-all before:duration-[160ms] before:ease-[ease] before:content-['']",
                isActive &&
                  "bg-accent/10 text-accent-hover data-[hovered=true]:bg-accent/15 dark:bg-accent/15 dark:data-[hovered=true]:bg-accent/20 before:scale-y-100 before:opacity-100",
              )}
              isIconOnly={collapsed}
              onPress={() => {
                onActiveHrefChange(item.href);
              }}
              variant="ghost"
            >
              <DashboardIcon className="size-5 shrink-0" name={item.icon} />
              <span className={cn("transition-all", collapsed && "opacity-0")}>
                {item.label}
              </span>
            </Button>
            <Tooltip.Content offset={5} placement="right">
              {item.label}
            </Tooltip.Content>
          </Tooltip>
        );
      })}
    </div>
  );
}

function AccountPopover({
  compact,
  isLoggingOut,
  logoutError,
  onLogout,
  user,
}: SidebarSharedProps & { compact: boolean }) {
  const [isLogoutDialogOpen, setIsLogoutDialogOpen] = useState(false);

  const isMobile = useMediaQuery("(max-width: 761px)");
  const login = user?.login ?? "Пользователь";
  const name =
    user?.firstName || user?.lastName
      ? `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim()
      : login;
  const role = user?.role ? roleLabels[user.role] : "Роль не назначена";

  const randomNumberFromId = useMemo(
    () =>
      Array.from(user?.id ?? "").reduce((acc, curr) => {
        return acc + (!isNaN(+curr) ? +curr : 0);
      }, 0),
    [user],
  );

  return (
    <>
      <Popover>
        <Button
          aria-label={`Профиль: ${login}`}
          className="h-12 w-full justify-start gap-3 rounded-[14px] px-1.5"
          isIconOnly={compact}
          variant="ghost"
        >
          <Avatar className="size-9">
            <Avatar.Image
              src={fallbackAvatars[randomNumberFromId % fallbackAvatars.length]}
            />
          </Avatar>
          <span
            className={cn(
              "min-w-0 text-left transition-all",
              compact && "opacity-0",
            )}
          >
            <span className="block truncate text-sm font-semibold">
              {user?.firstName || user?.lastName
                ? `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim()
                : login}
            </span>
            <span className="text-copy-muted block truncate text-xs">
              {role}
            </span>
          </span>
        </Button>

        <Popover.Content
          offset={12}
          placement={!isMobile ? "right" : undefined}
        >
          <Popover.Dialog className="border-border bg-surface w-[min(280px,calc(100vw-24px))] space-y-3 rounded-[calc(var(--radius-2xl)+4px)] border p-2.5 shadow-2xl/15">
            <div className="w-full gap-1 rounded-2xl p-2">
              <div className="flex flex-wrap items-center gap-2">
                <Popover.Heading className="truncate text-sm font-semibold">
                  <div className="flex gap-3">
                    <div className="relative shrink-0">
                      <Avatar>
                        <Avatar.Image
                          src={
                            fallbackAvatars[
                              randomNumberFromId % fallbackAvatars.length
                            ]
                          }
                        />
                      </Avatar>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1 truncate text-sm font-medium tracking-[-0.015em]">
                        {name}
                      </div>
                      <p className="text-copy-muted mt-0.5 truncate text-xs font-normal">
                        {role}
                      </p>
                      <p className="text-accent-hover mt-0.5 truncate text-xs font-normal">
                        @{user?.login ?? "Пользователь"}
                      </p>
                    </div>
                  </div>
                </Popover.Heading>
                {logoutError ? (
                  <p className="text-destructive mt-3 text-xs" role="alert">
                    {logoutError}
                  </p>
                ) : null}
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-copy-muted ml-3 text-xs font-medium">
                Тема оформления
              </p>
              <div className="bg-surface-low w-full gap-1 rounded-2xl">
                <ThemeSwitcher />
              </div>
            </div>
            <Button
              className="w-full"
              onPress={() => setIsLogoutDialogOpen(true)}
              size="sm"
              variant="danger-soft"
            >
              Выйти
            </Button>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>

      <LogoutConfirmationDialog
        isOpen={isLogoutDialogOpen}
        isPending={isLoggingOut}
        onConfirm={onLogout}
        onOpenChange={setIsLogoutDialogOpen}
      />
    </>
  );
}

interface SidebarContentProps extends SidebarSharedProps {
  collapsed: boolean;
  onNavigate?: () => void;
}

function SidebarContent({
  collapsed,
  isLoggingOut,
  logoutError,
  onNavigate,
  onLogout,
  user,
}: SidebarContentProps) {
  const isMobile = useMediaQuery("(max-width: 760px)");
  const location = useLocation();
  const navigate = useNavigate();
  const visiblePrimaryItems = primaryItems.filter(
    (item) =>
      !item.roles || (user?.role != null && item.roles.includes(user.role)),
  );

  const onActiveHrefChange = (href: string) => {
    void navigate(href);
    onNavigate?.();
  };

  return (
    <>
      <ScrollShadow
        hideScrollBar={isMobile || collapsed}
        className="flex min-h-0 flex-1 flex-col overflow-x-hidden py-1"
      >
        <nav
          aria-label="Основная навигация"
          className="flex min-h-0 flex-1 flex-col gap-1.5"
        >
          <NavigationList
            activeHref={location.pathname}
            collapsed={collapsed}
            items={visiblePrimaryItems}
            onActiveHrefChange={onActiveHrefChange}
          />
          <div className="bg-border/50 mx-auto mb-auto h-px w-[95%] flex-none" />
          <NavigationList
            activeHref={location.pathname}
            collapsed={collapsed}
            items={secondaryItems}
            onActiveHrefChange={onActiveHrefChange}
          />
        </nav>
      </ScrollShadow>
      <div className="mt-4">
        <AccountPopover
          compact={collapsed}
          isLoggingOut={isLoggingOut}
          logoutError={logoutError}
          onLogout={onLogout}
          user={user}
        />
      </div>
    </>
  );
}

export function WorkspaceSidebar(props: SidebarSharedProps) {
  const isNarrow = useMediaQuery("(max-width: 1280px)");
  const [isManuallyCollapsed, setIsManuallyCollapsed] = useState(
    getStoredSidebarCollapsed,
  );
  const isCollapsed = isNarrow || isManuallyCollapsed;

  const setManualCollapsed = (collapsed: boolean) => {
    setIsManuallyCollapsed(collapsed);
    saveSidebarCollapsed(collapsed);
  };

  return (
    <aside
      aria-label="Боковая панель"
      className={cn(
        "bg-surface hidden h-svh shrink-0 flex-col py-3 transition-[width] duration-200 *:px-3 min-[761px]:flex sm:py-5",
        isCollapsed ? "w-[72px]" : "w-[var(--sidebar-width)]",
      )}
      data-collapsed={isCollapsed}
    >
      <div className="mb-6 flex h-10 items-center">
        {isCollapsed ? (
          <Button
            aria-expanded="false"
            aria-label="Развернуть боковую панель"
            className="size-10 min-w-12 justify-start rounded-xl p-0 px-2.5 disabled:opacity-100"
            isIconOnly
            isDisabled={isNarrow}
            onPress={() => {
              setManualCollapsed(false);
            }}
            variant="ghost"
          >
            <BrandMark className="text-accent size-8" />
          </Button>
        ) : (
          <>
            <div className="flex min-w-0 flex-1 items-center gap-2 pl-2">
              <BrandMark className="text-accent size-8 shrink-0" />
              <p className="truncate font-medium">
                Инспектор <span className="text-accent font-semibold">ИИ</span>
              </p>
            </div>
            <Button
              aria-expanded="true"
              aria-label="Свернуть боковую панель"
              className="justify-left text-muted-foreground size-9 min-w-9 rounded-xl"
              isIconOnly
              onPress={() => {
                setManualCollapsed(true);
              }}
              variant="ghost"
            >
              <DashboardIcon className="size-[18px]" name="chevron-left" />
            </Button>
          </>
        )}
      </div>

      <SidebarContent collapsed={isCollapsed} {...props} />
    </aside>
  );
}

export function MobileNavigation(props: SidebarSharedProps) {
  const drawerState = useOverlayState();

  return (
    <Drawer state={drawerState}>
      <Button
        aria-label="Открыть меню"
        className="size-11 min-w-11 rounded-[14px]"
        isIconOnly
        variant="ghost"
      >
        <DashboardIcon className="size-5" name="menu" />
      </Button>
      <Drawer.Backdrop>
        <Drawer.Content
          className="w-[min(330px,calc(100vw-24px))]"
          placement="left"
        >
          <Drawer.Dialog
            aria-label="Навигация"
            className={cn(
              "bg-surface flex h-full flex-col p-0 pr-10",
              "after:bg-border after:pointer-events-none after:absolute after:top-1/2 after:right-2 after:h-12 after:w-1 after:-translate-y-1/2 after:rounded-full",
            )}
          >
            <Drawer.CloseTrigger
              aria-label="Закрыть меню"
              className="sr-only"
            />
            <Drawer.Header className="flex-row items-center gap-3 px-4 py-4">
              <BrandMark className="text-accent size-9" />
              <Drawer.Heading className="text-base font-semibold">
                <p className="truncate font-medium">
                  Инспектор{" "}
                  <span className="text-accent font-semibold">ИИ</span>
                </p>
              </Drawer.Heading>
            </Drawer.Header>
            <Drawer.Body className="mt-0 flex min-h-0 flex-1 flex-col py-2 pt-0 *:px-3 *:pr-0">
              <SidebarContent
                collapsed={false}
                onNavigate={() => {
                  drawerState.close();
                }}
                {...props}
              />
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
