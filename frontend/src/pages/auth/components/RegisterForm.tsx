import {
  Alert,
  Description,
  FieldError,
  Input,
  Label,
  TextField,
} from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";

import { useRegister } from "@/api/hooks/use-auth";
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
              placeholder="Придумайте логин"
            />
            <FieldError>{fieldState.error?.message}</FieldError>
          </TextField>
        )}
      />

      <div className="flex flex-col gap-5 sm:flex-row">
        <Controller
          control={control}
          name="lastName"
          render={({ field, fieldState }) => (
            <TextField
              fullWidth
              isInvalid={fieldState.invalid}
              isRequired
              name={field.name}
            >
              <Label>Фамилия</Label>
              <Input
                {...field}
                autoComplete="family-name"
                placeholder="Иванов"
              />
              <FieldError>{fieldState.error?.message}</FieldError>
            </TextField>
          )}
        />

        <Controller
          control={control}
          name="firstName"
          render={({ field, fieldState }) => (
            <TextField
              fullWidth
              isInvalid={fieldState.invalid}
              isRequired
              name={field.name}
            >
              <Label>Имя</Label>
              <Input {...field} autoComplete="given-name" placeholder="Иван" />
              <FieldError>{fieldState.error?.message}</FieldError>
            </TextField>
          )}
        />
      </div>

      <div className="flex flex-col gap-5 sm:flex-row">
        <Controller
          control={control}
          name="patronymic"
          render={({ field, fieldState }) => (
            <TextField
              fullWidth
              isInvalid={fieldState.invalid}
              name={field.name}
            >
              <Label>Отчество</Label>
              <Input
                {...field}
                autoComplete="additional-name"
                placeholder="Иванович"
              />
              <FieldError>{fieldState.error?.message}</FieldError>
            </TextField>
          )}
        />

        <Controller
          control={control}
          name="phone"
          render={({ field, fieldState }) => (
            <TextField
              fullWidth
              isInvalid={fieldState.invalid}
              name={field.name}
            >
              <Label>Номер телефона</Label>
              <Input
                {...field}
                autoComplete="tel"
                placeholder="+7 900 123-45-67"
                type="tel"
              />
              <FieldError>{fieldState.error?.message}</FieldError>
            </TextField>
          )}
        />
      </div>

      <Controller
        control={control}
        name="email"
        render={({ field, fieldState }) => (
          <TextField fullWidth isInvalid={fieldState.invalid} name={field.name}>
            <Label>Почта</Label>
            <Input
              {...field}
              autoComplete="email"
              placeholder="ivanov@example.ru"
              type="email"
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
              autoComplete="new-password"
              placeholder="Придумайте пароль"
            />
            {fieldState.error ? (
              <FieldError>{fieldState.error.message}</FieldError>
            ) : (
              <Description>Не менее 12 символов</Description>
            )}
          </TextField>
        )}
      />

      <Controller
        control={control}
        name="passwordConfirmation"
        render={({ field, fieldState }) => (
          <TextField
            fullWidth
            isInvalid={fieldState.invalid}
            isRequired
            name={field.name}
            type="password"
          >
            <Label>Повторите пароль</Label>
            <Input
              {...field}
              autoComplete="new-password"
              placeholder="Введите пароль ещё раз"
            />
            <FieldError>{fieldState.error?.message}</FieldError>
          </TextField>
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
