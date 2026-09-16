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
} from "@/pages/auth/auth-schema";
import routeNames from "@/routes/routeNames";
import { SubmitButton } from "./SubmitButton";

export function RegisterForm() {
  const navigate = useNavigate();
  const registerMutation = useRegister();
  const { control, handleSubmit } = useForm<RegisterFormValues>({
    defaultValues: { login: "", password: "", passwordConfirmation: "" },
    resolver: zodResolver(registerSchema),
  });

  const submit = handleSubmit((values) => {
    const parsedValues = registerSchema.parse(values);
    registerMutation.mutate(
      {
        login: parsedValues.login,
        password: parsedValues.password,
      },
      {
        onSuccess: () => {
          void navigate(routeNames.APP, { replace: true });
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
        <Alert role="alert" status="danger">
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
