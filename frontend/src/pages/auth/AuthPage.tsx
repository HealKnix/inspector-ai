import { Link } from "react-router-dom";

import routeNames from "@/routes/routeNames";

import { AuthVisual } from "./components/AuthVisual";
import { LoginForm } from "./components/LoginForm";
import { RegisterForm } from "./components/RegisterForm";

interface AuthPageProps {
  mode: "login" | "register";
}

const pageContent = {
  login: {
    title: "С возвращением",
    description: "Войдите, чтобы продолжить работу в сервисе.",
    switchLabel: "Ещё нет аккаунта?",
    switchAction: "Зарегистрироваться",
    switchHref: routeNames.REGISTER,
  },
  register: {
    title: "Создайте аккаунт",
    description: "Укажите логин и пароль для доступа к сервису.",
    switchLabel: "Уже есть аккаунт?",
    switchAction: "Войти",
    switchHref: routeNames.LOGIN,
  },
} as const;

export function AuthPage({ mode }: AuthPageProps) {
  const content = pageContent[mode];

  return (
    <main className="bg-background max-[760px]:bg-surface min-h-svh min-w-80 p-[clamp(10px,1.25vw,22px)] max-[760px]:p-0">
      <div className="border-border bg-surface mx-auto grid min-h-[calc(100svh-clamp(20px,2.5vw,44px))] grid-cols-[minmax(0,1.05fr)_minmax(430px,0.95fr)] overflow-hidden rounded-[clamp(24px,2.4vw,40px)] border max-[980px]:grid-cols-[minmax(0,0.9fr)_minmax(390px,1.1fr)] max-[760px]:block max-[760px]:min-h-svh max-[760px]:rounded-none max-[760px]:border-0">
        <AuthVisual />

        <section
          className="grid place-items-center p-[clamp(44px,6vw,104px)] max-[760px]:px-6 max-[760px]:pt-[42px] max-[760px]:pb-[54px]"
          aria-labelledby="auth-title"
        >
          <div className="w-[min(100%,430px)]">
            <header className="mb-9">
              <p className="text-muted-foreground mb-4 hidden text-xs font-[680] tracking-[0.08em] uppercase max-[760px]:block">
                Инспектор ИИ
              </p>
              <h2
                id="auth-title"
                className="text-foreground m-0 text-[clamp(38px,3.4vw,56px)] leading-none font-[520] tracking-[-0.05em]"
              >
                {content.title}
              </h2>
              <p className="text-copy-muted mt-[18px] text-[15px] leading-[1.55]">
                {content.description}
              </p>
            </header>

            {mode === "login" ? <LoginForm /> : <RegisterForm />}

            <p className="text-copy-muted mt-6 text-center text-sm">
              {content.switchLabel}{" "}
              <Link
                className="text-link font-medium hover:underline hover:underline-offset-3"
                to={content.switchHref}
              >
                {content.switchAction}
              </Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
