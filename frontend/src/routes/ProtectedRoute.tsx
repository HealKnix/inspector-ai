import { Spinner } from "@heroui/react";
import { Navigate, Outlet } from "react-router-dom";

import routeNames from "@/routes/routeNames";
import { useAuthSessionStore } from "@/store/auth-session";

export function ProtectedRoute() {
  const initialized = useAuthSessionStore((state) => state.initialized);
  const user = useAuthSessionStore((state) => state.user);

  if (!initialized) {
    return (
      <div
        className="text-muted-foreground mx-auto flex min-h-svh w-[calc(100%-2rem)] max-w-[560px] flex-col items-center justify-center gap-[18px]"
        role="status"
      >
        <Spinner size="lg" />
        <p>Проверяем сессию…</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate replace to={routeNames.LOGIN} />;
  }

  return <Outlet />;
}
