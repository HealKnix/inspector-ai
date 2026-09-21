import { Alert } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";

import { useLogin } from "@/api/hooks/use-auth";
import { Input } from "@/components/input/Input";
import { loginSchema, type LoginFormValues } from "@/pages/auth/auth-schema";
import routeNames from "@/routes/routeNames";
import { SubmitButton } from "./SubmitButton";

export function LoginForm() {
  const navigate = useNavigate();
  const loginMutation = useLogin();
  const { control, handleSubmit } = useForm<LoginFormValues>({
    defaultValues: { login: "", password: "" },
    resolver: zodResolver(loginSchema),
  });

  const submit = handleSubmit((values) => {
    const parsedValues = loginSchema.parse(values);
    loginMutation.mutate(parsedValues, {
      onSuccess: () => {
        void navigate(routeNames.ROOT, { replace: true });
      },
    });
  });

  return (
    <form
      className="flex flex-col gap-5"
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      {loginMutation.error ? (
        <Alert
          role="alert"
          status="danger"
          className="bg-danger/10 shadow-none"
        >
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Не удалось войти</Alert.Title>
            <Alert.Description>{loginMutation.error.message}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <Controller
        control={control}
        name="login"
        render={({ field, fieldState }) => (
          <Input
            {...field}
            autoComplete="username"
            errorMessage={fieldState.error?.message}
            fullWidth
            isInvalid={fieldState.invalid}
            isRequired
            label="Логин"
            placeholder="Введите логин"
          />
        )}
      />

      <Controller
        control={control}
        name="password"
        render={({ field, fieldState }) => (
          <Input
            {...field}
            autoComplete="current-password"
            errorMessage={fieldState.error?.message}
            fullWidth
            isInvalid={fieldState.invalid}
            isRequired
            label="Пароль"
            placeholder="Введите пароль"
            type="password"
          />
        )}
      />

      <div className="pt-1">
        <SubmitButton
          isPending={loginMutation.isPending}
          label="Войти"
          pendingLabel="Входим…"
        />
      </div>
    </form>
  );
}
