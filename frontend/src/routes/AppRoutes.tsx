import { Alert, Button, Spinner } from "@heroui/react";
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { useCurrentUser } from "@/api/hooks/use-auth";
import routeNames from "@/routes/routeNames";

import { ProtectedRoute } from "./ProtectedRoute";
import { PublicOnlyRoute } from "./PublicOnlyRoute";

const AuthPage = lazy(() =>
  import("@/pages/auth/AuthPage").then((module) => ({
    default: module.AuthPage,
  })),
);
const DashboardPage = lazy(() =>
  import("@/pages/dashboard/DashboardPage").then((module) => ({
    default: module.DashboardPage,
  })),
);

export function AppRoutes() {
  const currentUserQuery = useCurrentUser();

  if (currentUserQuery.isPending) {
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

  if (currentUserQuery.isError) {
    return (
      <div className="text-muted-foreground mx-auto flex min-h-svh w-[calc(100%-2rem)] max-w-[560px] flex-col items-center justify-center gap-[18px]">
        <Alert role="alert" status="danger">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Не удалось проверить сессию</Alert.Title>
            <Alert.Description>
              {currentUserQuery.error.message}
            </Alert.Description>
          </Alert.Content>
        </Alert>
        <Button
          onPress={() => {
            void currentUserQuery.refetch();
          }}
          variant="secondary"
        >
          Повторить
        </Button>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div
          className="text-muted-foreground mx-auto flex min-h-svh w-[calc(100%-2rem)] max-w-[560px] flex-col items-center justify-center gap-[18px]"
          role="status"
        >
          <p>Загружаем интерфейс…</p>
        </div>
      }
    >
      <Routes>
        <Route element={<PublicOnlyRoute />}>
          <Route element={<AuthPage mode="login" />} path={routeNames.LOGIN} />
          <Route
            element={<AuthPage mode="register" />}
            path={routeNames.REGISTER}
          />
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route element={<DashboardPage />} path={routeNames.APP} />
        </Route>
        <Route
          element={<Navigate replace to={routeNames.APP} />}
          path={routeNames.ROOT}
        />
        <Route
          element={<Navigate replace to={routeNames.APP} />}
          path={routeNames.NOT_FOUND}
        />
      </Routes>
    </Suspense>
  );
}
