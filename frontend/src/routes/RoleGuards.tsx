import { Alert, Spinner } from "@heroui/react";
import { Navigate, Outlet } from "react-router-dom";

import type { Role } from "@/api/types/auth";
import routeNames from "@/routes/routeNames";
import { useAuthSessionStore } from "@/store/auth-session";

interface RoleGuardProps {
  roles: Role | readonly Role[];
}

export function RoleGuard({ roles }: RoleGuardProps) {
  const initialized = useAuthSessionStore((state) => state.initialized);
  const user = useAuthSessionStore((state) => state.user);

  if (!initialized) {
    return (
      <div
        className="text-muted-foreground mx-auto flex min-h-svh w-[calc(100%-2rem)] max-w-[560px] flex-col items-center justify-center gap-[18px]"
        role="status"
      >
        <Spinner size="lg" />
        <p>Проверяем права доступа…</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate replace to={routeNames.LOGIN} />;
  }

  const allowedRoles = typeof roles === "string" ? [roles] : roles;

  if (!user.role || !allowedRoles.includes(user.role)) {
    return (
      <div className="mx-auto flex min-h-svh w-[calc(100%-2rem)] max-w-[560px] items-center justify-center">
        <Alert role="alert" status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Недостаточно прав</Alert.Title>
            <Alert.Description>
              Ваша роль не предоставляет доступ к этому разделу.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      </div>
    );
  }

  return <Outlet />;
}
