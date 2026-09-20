import { useMediaQuery } from "@heroui/react";
import { Suspense } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

import { useLogout } from "@/api/hooks/use-auth";
import { BrandMark } from "@/components/BrandMark";
import { CubeLoader } from "@/components/cube-loader/CubeLoader";
import {
  MobileNavigation,
  WorkspaceSidebar,
} from "@/pages/dashboard/components/WorkspaceSidebar";
import routeNames from "@/routes/routeNames";
import { useAuthSessionStore } from "@/store/auth-session";

export function WorkspaceLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = useAuthSessionStore((state) => state.user);
  const logoutMutation = useLogout();
  const isMobile = useMediaQuery("(max-width: 760px)");

  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        void navigate(routeNames.LOGIN, { replace: true });
      },
    });
  };

  const sidebarProps = {
    isLoggingOut: logoutMutation.isPending,
    logoutError: logoutMutation.error?.message,
    onLogout: handleLogout,
    user,
  };

  return (
    <div className="flex h-svh min-w-80 overflow-hidden">
      {isMobile ? null : <WorkspaceSidebar {...sidebarProps} />}

      <div className="flex min-w-0 flex-1 flex-col">
        {isMobile ? (
          <header className="border-border bg-surface flex min-h-16 items-center gap-3 border-b px-3">
            <MobileNavigation {...sidebarProps} />
            <BrandMark className="text-accent size-8 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              Инспектор ИИ
            </span>
          </header>
        ) : null}

        <main className="relative flex min-h-0 min-w-0 flex-1">
          <Suspense
            fallback={
              <div
                className="text-muted-foreground flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-5"
                role="status"
              >
                <CubeLoader />
                <p>Загружаем интерфейс…</p>
              </div>
            }
            key={location.pathname}
          >
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
