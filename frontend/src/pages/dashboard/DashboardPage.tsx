import { Alert, Button } from "@heroui/react";
import { useNavigate } from "react-router-dom";

import { useLogout } from "@/api/hooks/use-auth";
import { BrandMark } from "@/components/brand/BrandMark";
import routeNames from "@/routes/routeNames";
import { useAuthSessionStore } from "@/store/auth-session";

function GridIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      viewBox="0 0 24 24"
      width="20"
    >
      <path
        d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      viewBox="0 0 24 24"
      width="20"
    >
      <path
        d="M7 3.5h7l4 4V20H7z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
      <path
        d="M14 3.5V8h4M9.5 12h6M9.5 15.5h6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      viewBox="0 0 24 24"
      width="20"
    >
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M18 6l-1.4 1.4M7.4 16.6 6 18M18 18l-1.4-1.4M7.4 7.4 6 6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();
  const user = useAuthSessionStore((state) => state.user);
  const logoutMutation = useLogout();

  const handleLogout = () => {
    logoutMutation.mutate(undefined, {
      onSuccess: () => {
        void navigate(routeNames.LOGIN, { replace: true });
      },
    });
  };

  return (
    <main className="bg-background max-[760px]:bg-surface min-h-svh min-w-80 p-3 max-[760px]:p-0">
      <div className="border-border bg-surface shadow-overlay grid min-h-[calc(100svh-24px)] grid-cols-[72px_minmax(0,1fr)] overflow-hidden rounded-[28px] border max-[760px]:block max-[760px]:min-h-svh max-[760px]:rounded-none max-[760px]:border-0 max-[760px]:shadow-none">
        <aside
          className="border-line flex flex-col items-center gap-[34px] border-r px-3 py-5 max-[760px]:hidden"
          aria-label="Основная навигация"
        >
          <BrandMark className="text-foreground size-9" />
          <nav className="flex flex-col gap-[14px]">
            <Button aria-label="Рабочая область" isIconOnly size="sm">
              <GridIcon />
            </Button>
            <Button
              aria-label="Документы — раздел появится позже"
              isDisabled
              isIconOnly
              size="sm"
              variant="ghost"
            >
              <DocumentIcon />
            </Button>
          </nav>
          <Button
            aria-label="Настройки — раздел появится позже"
            className="mt-auto"
            isDisabled
            isIconOnly
            size="sm"
            variant="ghost"
          >
            <SettingsIcon />
          </Button>
        </aside>

        <section className="min-w-0">
          <header className="border-line flex min-h-[72px] items-center justify-between border-b px-7 py-3 max-[760px]:px-[18px]">
            <div className="max-[760px]:hidden">
              <p className="text-foreground text-xs font-[680] tracking-[0.08em] uppercase">
                Рабочая область
              </p>
              <p className="text-copy-muted mt-1 text-xs">
                Начальная настройка
              </p>
            </div>
            <div className="flex items-center gap-3 max-[760px]:w-full max-[760px]:justify-end">
              <div
                className="bg-accent text-accent-foreground grid size-[34px] place-items-center rounded-full text-[13px] font-bold"
                aria-hidden="true"
              >
                {user?.login.slice(0, 1).toUpperCase()}
              </div>
              <div className="flex min-w-[150px] flex-col max-[760px]:hidden">
                <span className="max-w-[min(26vw,240px)] truncate text-[13px] font-[650]">
                  {user?.login}
                </span>
                <small className="text-copy-muted mt-0.5 text-[11px]">
                  Авторизованный пользователь
                </small>
              </div>
              <Button
                isPending={logoutMutation.isPending}
                onPress={handleLogout}
                size="sm"
                variant="tertiary"
              >
                Выйти
              </Button>
            </div>
          </header>

          <div className="p-[clamp(28px,4vw,62px)] max-[760px]:px-[18px] max-[760px]:pt-7 max-[760px]:pb-11">
            {logoutMutation.error ? (
              <Alert className="mb-6" role="alert" status="danger">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>Не удалось выйти</Alert.Title>
                  <Alert.Description>
                    {logoutMutation.error.message}
                  </Alert.Description>
                </Alert.Content>
              </Alert>
            ) : null}

            <div className="mb-[34px] flex items-end justify-between gap-10 max-[760px]:block">
              <div>
                <p className="text-muted-foreground text-xs font-[680] tracking-[0.08em] uppercase">
                  Инспектор ИИ
                </p>
                <h1 className="mt-2 text-[clamp(34px,3.6vw,58px)] leading-none font-[520] tracking-[-0.055em] [overflow-wrap:anywhere]">
                  Добро пожаловать, {user?.login}
                </h1>
              </div>
              <p className="text-copy-muted max-w-[430px] text-sm leading-[1.6] max-[760px]:mt-[18px]">
                Здесь появятся инструменты проверки после утверждения
                предметного контракта.
              </p>
            </div>

            <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(300px,0.75fr)] gap-[18px] max-[980px]:grid-cols-1">
              <article className="bg-accent text-accent-foreground relative min-h-[260px] overflow-hidden rounded-[26px] p-[clamp(26px,3vw,42px)] max-[760px]:min-h-[250px] max-[760px]:rounded-[22px]">
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-[70px] -bottom-[120px] size-[380px] bg-[radial-gradient(circle,var(--accent-foreground)_0%,transparent_66%)] opacity-50"
                />
                <p className="text-accent-foreground/[0.74] mb-7 text-[13px]">
                  Доступ к сервису
                </p>
                <h2 className="relative z-1 max-w-[520px] text-[clamp(34px,4vw,60px)] leading-none font-[450] tracking-[-0.05em]">
                  Рабочая среда готова
                </h2>
                <span className="text-accent-foreground/[0.74] mt-[22px] block max-w-[480px] text-sm leading-[1.55]">
                  Регистрация, вход и серверная защита маршрута подключены.
                </span>
                <div className="border-accent-foreground/20 bg-accent-foreground/15 absolute right-7 bottom-7 z-1 flex items-center gap-2 rounded-full border px-[13px] py-[9px] text-xs backdrop-blur-[12px] max-[760px]:static max-[760px]:mt-[34px] max-[760px]:w-fit">
                  <span
                    className="bg-success ring-success/15 size-[7px] rounded-full ring-4"
                    aria-hidden="true"
                  />
                  Сессия подтверждена
                </div>
              </article>

              <article className="border-line bg-surface-high row-span-2 flex min-h-[520px] flex-col rounded-[26px] border p-[clamp(26px,3vw,42px)] max-[980px]:row-auto max-[760px]:min-h-[430px] max-[760px]:rounded-[22px]">
                <div>
                  <p className="text-muted-foreground text-xs font-[680] tracking-[0.08em] uppercase">
                    Следующий этап
                  </p>
                  <h2 className="mt-2.5 text-[clamp(24px,2.3vw,36px)] leading-[1.08] font-[520] tracking-[-0.04em] [overflow-wrap:anywhere]">
                    Проверка документации
                  </h2>
                </div>
                <div
                  className="border-line my-[34px] flex min-h-[220px] flex-1 items-end gap-0.5 overflow-hidden border-b"
                  aria-hidden="true"
                >
                  <div className="from-accent/10 to-accent/40 h-[84%] flex-1 rounded-t-[10px] bg-linear-to-b" />
                  <div className="from-accent/10 to-accent/40 h-[65%] flex-1 rounded-t-[10px] bg-linear-to-b" />
                  <div className="from-accent/10 to-accent/40 h-[48%] flex-1 rounded-t-[10px] bg-linear-to-b" />
                  <div className="bg-accent h-[31%] flex-1 rounded-t-[10px]" />
                </div>
                <p className="text-copy-muted mt-auto max-w-[600px] text-sm leading-[1.6]">
                  Загрузка ПД, РД и ИД будет реализована после появления точных
                  требований к документам, статусам и доступам.
                </p>
              </article>

              <article className="border-line bg-surface-high flex min-h-[260px] flex-col rounded-[26px] border p-[clamp(26px,3vw,42px)] max-[760px]:min-h-[250px] max-[760px]:rounded-[22px]">
                <p className="text-muted-foreground text-xs font-[680] tracking-[0.08em] uppercase">
                  Учётная запись
                </p>
                <h2 className="mt-2.5 text-[clamp(24px,2.3vw,36px)] leading-[1.08] font-[520] tracking-[-0.04em] [overflow-wrap:anywhere]">
                  {user?.login}
                </h2>
                <div className="border-line mt-auto flex items-end justify-between gap-[18px] border-t pt-7">
                  <span className="text-muted-foreground text-xs">Создана</span>
                  <strong className="text-right text-[13px] font-semibold">
                    {user
                      ? new Intl.DateTimeFormat("ru-RU", {
                          dateStyle: "long",
                        }).format(new Date(user.createdAt))
                      : "—"}
                  </strong>
                </div>
              </article>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
