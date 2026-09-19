import { Alert, Button, Spinner } from "@heroui/react";
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";

import { useCurrentUser } from "@/api/hooks/use-auth";
import { WorkspaceLayout } from "@/layouts/WorkspaceLayout";
import routeNames from "@/routes/routeNames";

import { CubeLoader } from "@/components/cube-loader/CubeLoader";
import { ProtectedRoute } from "./ProtectedRoute";
import { PublicOnlyRoute } from "./PublicOnlyRoute";
import { RoleGuard } from "./RoleGuards";

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
const DocumentUploadPage = lazy(() =>
  import("@/pages/document-upload/DocumentUploadPage").then((module) => ({
    default: module.DocumentUploadPage,
  })),
);
const ObjectsPage = lazy(() =>
  import("@/pages/objects/ObjectsPage").then((module) => ({
    default: module.ObjectsPage,
  })),
);
const ObjectDetailsPage = lazy(() =>
  import("@/pages/object-details/ObjectDetailsPage").then((module) => ({
    default: module.ObjectDetailsPage,
  })),
);
const AdminMatrixPage = lazy(() =>
  import("@/pages/admin/AdminMatrixPage").then((module) => ({
    default: module.AdminMatrixPage,
  })),
);

export function AppRoutes() {
  const currentUserQuery = useCurrentUser();
  const location = useLocation();

  if (currentUserQuery.isPending) {
    return (
      <div
        className="text-muted-foreground mx-auto flex min-h-svh w-[calc(100%-2rem)] max-w-[560px] flex-col items-center justify-center gap-4.5"
        role="status"
      >
        <Spinner size="lg" />
        <p>Проверяем сессию…</p>
      </div>
    );
  }

  if (currentUserQuery.isError) {
    return (
      <div className="text-muted-foreground mx-auto flex min-h-svh w-[calc(100%-2rem)] max-w-[560px] flex-col items-center justify-center gap-4.5">
        <Alert
          role="alert"
          status="danger"
          className="bg-danger/10 shadow-none"
        >
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
          className="text-muted-foreground mx-auto flex min-h-svh w-[calc(100%-2rem)] max-w-[560px] flex-col items-center justify-center gap-5"
          role="status"
        >
          <CubeLoader />
          <p>Загружаем интерфейс…</p>
        </div>
      }
      key={location.pathname}
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
          <Route element={<WorkspaceLayout />}>
            <Route element={<DashboardPage />} path={routeNames.APP} />
            <Route
              element={<DocumentUploadPage />}
              path={routeNames.DOCUMENT_UPLOAD}
            />
            <Route element={<ObjectsPage />} path={routeNames.OBJECTS} />
            <Route
              element={<ObjectDetailsPage />}
              path={routeNames.OBJECT_DETAILS}
            />
          </Route>
          <Route element={<RoleGuard roles="ADMINISTRATOR" />}>
            <Route element={<WorkspaceLayout />}>
              <Route
                element={<AdminMatrixPage />}
                path={routeNames.ADMIN_MATRIX}
              />
            </Route>
          </Route>
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
