import { Button, useMediaQuery } from "@heroui/react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useLogout } from "@/api/hooks/use-auth";
import { BrandMark } from "@/components/BrandMark";
import routeNames from "@/routes/routeNames";
import { useAuthSessionStore } from "@/store/auth-session";

import { cn } from "@/lib/utils";
import { ChatPanel } from "./components/ChatPanel";
import { InsightsWorkspace } from "./components/InsightsWorkspace";
import {
  MobileNavigation,
  WorkspaceSidebar,
} from "./components/WorkspaceSidebar";

type MobileWorkspace = "chat" | "dashboard";

export function DashboardPage() {
  const navigate = useNavigate();
  const user = useAuthSessionStore((state) => state.user);
  const logoutMutation = useLogout();
  const isMobile = useMediaQuery("(max-width: 760px)");
  const [mobileWorkspace, setMobileWorkspace] =
    useState<MobileWorkspace>("chat");

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
    <main className="bg-surface h-svh min-w-80 overflow-hidden">
      <div className="flex h-full min-w-0">
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

          {isMobile ? (
            <div
              aria-label="Раздел рабочей области"
              className="border-border bg-surface flex gap-1 border-b p-1.5"
              role="tablist"
            >
              <Button
                aria-controls="mobile-chat-panel"
                aria-selected={mobileWorkspace === "chat"}
                className={cn(
                  "h-10 flex-1 rounded-xl",
                  mobileWorkspace === "chat"
                    ? "bg-foreground text-background"
                    : "text-copy-muted",
                )}
                id="mobile-chat-tab"
                onPress={() => {
                  setMobileWorkspace("chat");
                }}
                render={(props) => <button {...props} role="tab" />}
                variant="ghost"
              >
                Чат
              </Button>
              <Button
                aria-controls="mobile-dashboard-panel"
                aria-selected={mobileWorkspace === "dashboard"}
                className={cn(
                  "h-10 flex-1 rounded-xl",
                  mobileWorkspace === "dashboard"
                    ? "bg-foreground text-background"
                    : "text-copy-muted",
                )}
                id="mobile-dashboard-tab"
                onPress={() => {
                  setMobileWorkspace("dashboard");
                }}
                render={(props) => <button {...props} role="tab" />}
                variant="ghost"
              >
                Dashboard
              </Button>
            </div>
          ) : null}

          <div className="flex min-h-0 min-w-0 flex-1">
            {isMobile ? (
              mobileWorkspace === "chat" ? (
                <div
                  aria-labelledby="mobile-chat-tab"
                  className="min-w-0 flex-1"
                  id="mobile-chat-panel"
                  role="tabpanel"
                >
                  <ChatPanel className="h-full min-w-0" />
                </div>
              ) : (
                <div
                  aria-labelledby="mobile-dashboard-tab"
                  className="min-w-0 flex-1"
                  id="mobile-dashboard-panel"
                  role="tabpanel"
                >
                  <InsightsWorkspace className="h-full min-w-0" />
                </div>
              )
            ) : (
              <>
                <ChatPanel className="w-[clamp(340px,29vw,470px)] shrink-0" />
                <InsightsWorkspace className="min-w-0 flex-1" />
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
