import { Button, useMediaQuery } from "@heroui/react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import { ChatPanel } from "./components/ChatPanel";
import { InsightsWorkspace } from "./components/InsightsWorkspace";

type MobileWorkspace = "chat" | "dashboard";

export function DashboardPage() {
  const isMobile = useMediaQuery("(max-width: 760px)");
  const [mobileWorkspace, setMobileWorkspace] =
    useState<MobileWorkspace>("chat");

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
  );
}
