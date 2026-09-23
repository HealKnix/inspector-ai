import { Alert } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";

import { useRegister } from "@/api/hooks/use-auth";
import { Input } from "@/components/input/Input";
import {
  registerSchema,
  type RegisterFormValues,
  type RegisterSubmitValues,
} from "@/pages/auth/auth-schema";
import routeNames from "@/routes/routeNames";
import { SubmitButton } from "./SubmitButton";

export function RegisterForm() {
  const navigate = useNavigate();
  const registerMutation = useRegister();
  const { control, handleSubmit } = useForm<
    RegisterFormValues,
    unknown,
    RegisterSubmitValues
  >({
    defaultValues: {
      login: "",
      password: "",
      passwordConfirmation: "",
      lastName: "",
      firstName: "",
      patronymic: "",
      phone: "",
      email: "",
    },
    resolver: zodResolver(registerSchema),
  });

  const submit = handleSubmit((values) => {
    registerMutation.mutate(
      {
        login: values.login,
        password: values.password,
        lastName: values.lastName,
        firstName: values.firstName,
        patronymic: values.patronymic,
        phone: values.phone,
        email: values.email,
      },
      {
        onSuccess: () => {
          void navigate(routeNames.ROOT, { replace: true });
        },
      },
    );
  });

  return (
    <form
      className="flex flex-col gap-5"
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      {registerMutation.error ? (
        <Alert
          role="alert"
          status="danger"
          className="bg-danger/10 shadow-none"
        >
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Не удалось создать аккаунт</Alert.Title>
            <Alert.Description>
              {registerMutation.error.message}
            </Alert.Description>
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
            placeholder="Придумайте логин"
          />
        )}
      />

      <div className="flex flex-col gap-5 sm:flex-row">
        <Controller
          control={control}
          name="lastName"
          render={({ field, fieldState }) => (
            <Input
              {...field}
              autoComplete="family-name"
              errorMessage={fieldState.error?.message}
              fullWidth
              isInvalid={fieldState.invalid}
              isRequired
              label="Фамилия"
              placeholder="Иванов"
            />
          )}
        />

        <Controller
          control={control}
          name="firstName"
          render={({ field, fieldState }) => (
            <Input
              {...field}
              autoComplete="given-name"
              errorMessage={fieldState.error?.message}
              fullWidth
              isInvalid={fieldState.invalid}
              isRequired
              label="Имя"
              placeholder="Иван"
            />
          )}
        />
      </div>

      <div className="flex flex-col gap-5 sm:flex-row">
        <Controller
          control={control}
          name="patronymic"
          render={({ field, fieldState }) => (
            <Input
              {...field}
              autoComplete="additional-name"
              errorMessage={fieldState.error?.message}
              fullWidth
              isInvalid={fieldState.invalid}
              label="Отчество"
              placeholder="Иванович"
            />
          )}
        />

        <Controller
          control={control}
          name="phone"
          render={({ field, fieldState }) => (
            <Input
              {...field}
              autoComplete="tel"
              errorMessage={fieldState.error?.message}
              fullWidth
              isInvalid={fieldState.invalid}
              label="Номер телефона"
              placeholder="+7 900 123-45-67"
              type="tel"
            />
          )}
        />
      </div>

      <Controller
        control={control}
        name="email"
        render={({ field, fieldState }) => (
          <Input
            {...field}
            autoComplete="email"
            errorMessage={fieldState.error?.message}
            fullWidth
            isInvalid={fieldState.invalid}
            label="Почта"
            placeholder="ivanov@example.ru"
            type="email"
          />
        )}
      />

      <Controller
        control={control}
        name="password"
        render={({ field, fieldState }) => (
          <Input
            {...field}
            autoComplete="new-password"
            description="Не менее 12 символов"
            errorMessage={fieldState.error?.message}
            fullWidth
            isInvalid={fieldState.invalid}
            isRequired
            label="Пароль"
            placeholder="Придумайте пароль"
            type="password"
          />
        )}
      />

      <Controller
        control={control}
        name="passwordConfirmation"
        render={({ field, fieldState }) => (
          <Input
            {...field}
            autoComplete="new-password"
            errorMessage={fieldState.error?.message}
            fullWidth
            isInvalid={fieldState.invalid}
            isRequired
            label="Повторите пароль"
            placeholder="Введите пароль ещё раз"
            type="password"
          />
        )}
      />

      <div className="pt-1">
        <SubmitButton
          isPending={registerMutation.isPending}
          label="Создать аккаунт"
          pendingLabel="Создаём…"
        />
      </div>
    </form>
  );
}
