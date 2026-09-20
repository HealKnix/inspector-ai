import { Spinner } from "@heroui/react";
import { Navigate, Outlet } from "react-router-dom";

import routeNames from "@/routes/routeNames";
import { useAuthSessionStore } from "@/store/auth-session";

export function PublicOnlyRoute() {
  const initialized = useAuthSessionStore((state) => state.initialized);
  const user = useAuthSessionStore((state) => state.user);

  if (!initialized) {
    return (
      <div
        className="text-muted-foreground mx-auto flex min-h-svh w-[calc(100%-2rem)] max-w-[560px] flex-col items-center justify-center gap-4.5"
        role="status"
      >
        <Spinner size="lg" />
        <p>Загружаем…</p>
      </div>
    );
  }

  if (user) {
    return <Navigate replace to={routeNames.ROOT} />;
  }

  return <Outlet />;
}
