import { Alert, FieldError, Input, Label, TextField } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";

import { useLogin } from "@/api/hooks/use-auth";
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
        void navigate(routeNames.APP, { replace: true });
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
          <TextField
            fullWidth
            isInvalid={fieldState.invalid}
            isRequired
            name={field.name}
          >
            <Label>Логин</Label>
            <Input
              {...field}
              autoComplete="username"
              placeholder="Введите логин"
            />
            <FieldError>{fieldState.error?.message}</FieldError>
          </TextField>
        )}
      />

      <Controller
        control={control}
        name="password"
        render={({ field, fieldState }) => (
          <TextField
            fullWidth
            isInvalid={fieldState.invalid}
            isRequired
            name={field.name}
            type="password"
          >
            <Label>Пароль</Label>
            <Input
              {...field}
              autoComplete="current-password"
              placeholder="Введите пароль"
            />
            <FieldError>{fieldState.error?.message}</FieldError>
          </TextField>
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
