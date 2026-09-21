import {
  Alert,
  Button,
  Description,
  Drawer,
  FieldError,
  Input,
  Label,
  ListBox,
  ScrollShadow,
  Select,
  TextField,
  type UseOverlayStateReturn,
} from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Controller,
  FormProvider,
  useForm,
  useFormContext,
} from "react-hook-form";

import { useCreateUser, useUpdateUser } from "@/api/hooks/use-users";
import { Role, roleLabels, type UserDto } from "@/api/types/auth";
import { UploadIcon } from "@/components/UploadIcon";
import {
  createUserSchema,
  updateUserSchema,
  type CreateUserFormValues,
  type CreateUserSubmitValues,
  type UpdateUserFormValues,
  type UpdateUserSubmitValues,
} from "@/pages/users/users-schema";

const EMPTY_ROLE_KEY = "none";

interface UserProfileFormValues {
  email: string;
  firstName: string;
  lastName: string;
  patronymic: string;
  phone: string;
  role: Role | null;
}

function UserProfileFields({
  allowEmptyRole,
  isRoleDisabled,
}: {
  allowEmptyRole?: boolean;
  isRoleDisabled?: boolean;
}) {
  const { control } = useFormContext<UserProfileFormValues>();

  return (
    <>
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

      <Controller
        control={control}
        name="patronymic"
        render={({ field, fieldState }) => (
          <TextField fullWidth isInvalid={fieldState.invalid} name={field.name}>
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
        name="role"
        render={({ field, fieldState }) => (
          <Select
            fullWidth
            isDisabled={isRoleDisabled}
            isInvalid={fieldState.invalid}
            name={field.name}
            onBlur={field.onBlur}
            onSelectionChange={(key) =>
              field.onChange(key === EMPTY_ROLE_KEY ? null : key)
            }
            selectedKey={field.value ?? EMPTY_ROLE_KEY}
          >
            <Label>Роль</Label>
            <Select.Trigger>
              <Select.Value className="max-w-full truncate" />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover className="not-sm:max-w-0">
              <ListBox>
                {allowEmptyRole ? (
                  <ListBox.Item
                    id={EMPTY_ROLE_KEY}
                    textValue="Без роли"
                    className="data-selected:text-accent data-selected:bg-accent/10 flex gap-2 data-selected:[&>p]:pr-4"
                  >
                    Без роли
                    <ListBox.ItemIndicator className="text-accent" />
                  </ListBox.Item>
                ) : null}
                {(
                  [
                    Role.INSPECTOR,
                    Role.ADMINISTRATOR,
                    Role.ML_ENGINEER,
                  ] as const
                ).map((role) => (
                  <ListBox.Item
                    key={role}
                    id={role}
                    textValue={roleLabels[role]}
                    className="data-selected:text-accent data-selected:bg-accent/10 flex gap-2 data-selected:[&>p]:pr-4"
                  >
                    {roleLabels[role]}
                    <ListBox.ItemIndicator className="text-accent" />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
            {isRoleDisabled ? (
              <Description>
                Свою роль может изменить только другой администратор
              </Description>
            ) : (
              <FieldError>{fieldState.error?.message}</FieldError>
            )}
          </Select>
        )}
      />

      <Controller
        control={control}
        name="phone"
        render={({ field, fieldState }) => (
          <TextField fullWidth isInvalid={fieldState.invalid} name={field.name}>
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
    </>
  );
}

function FormError({ message }: { message?: string }) {
  if (!message) return null;

  return (
    <Alert role="alert" status="danger" className="bg-danger/10 shadow-none">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>{message}</Alert.Description>
      </Alert.Content>
    </Alert>
  );
}

function CreateUserForm({ onSuccess }: { onSuccess: () => void }) {
  const createMutation = useCreateUser();
  const form = useForm<CreateUserFormValues, unknown, CreateUserSubmitValues>({
    defaultValues: {
      login: "",
      password: "",
      passwordConfirmation: "",
      lastName: "",
      firstName: "",
      patronymic: "",
      phone: "",
      email: "",
      role: Role.INSPECTOR,
    },
    resolver: zodResolver(createUserSchema),
  });

  const submit = form.handleSubmit((values) => {
    createMutation.mutate(
      {
        login: values.login,
        password: values.password,
        lastName: values.lastName,
        firstName: values.firstName,
        patronymic: values.patronymic,
        phone: values.phone,
        email: values.email,
        role: values.role,
      },
      { onSuccess },
    );
  });

  return (
    <FormProvider {...form}>
      <form
        className="flex flex-col gap-5"
        noValidate
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <FormError message={createMutation.error?.message} />

        <Controller
          control={form.control}
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
                autoComplete="off"
                placeholder="inspector.ivanov"
              />
              <FieldError>{fieldState.error?.message}</FieldError>
            </TextField>
          )}
        />

        <div className="flex flex-col gap-5 sm:flex-row">
          <Controller
            control={form.control}
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
            control={form.control}
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
                <Input {...field} autoComplete="new-password" />
                <FieldError>{fieldState.error?.message}</FieldError>
              </TextField>
            )}
          />
        </div>

        <UserProfileFields />

        <div className="mt-auto flex justify-end gap-3 pt-1">
          <Button
            type="submit"
            variant="primary"
            isPending={createMutation.isPending}
            className="rounded-xl"
          >
            Создать пользователя
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}

function EditUserForm({
  isSelf,
  onSuccess,
  user,
}: {
  isSelf: boolean;
  onSuccess: () => void;
  user: UserDto;
}) {
  const updateMutation = useUpdateUser();
  const form = useForm<UpdateUserFormValues, unknown, UpdateUserSubmitValues>({
    defaultValues: {
      lastName: user.lastName,
      firstName: user.firstName,
      patronymic: user.patronymic ?? "",
      phone: user.phone ?? "",
      email: user.email ?? "",
      role: user.role,
    },
    resolver: zodResolver(updateUserSchema),
  });

  const submit = form.handleSubmit((values) => {
    updateMutation.mutate(
      {
        id: user.id,
        lastName: values.lastName,
        firstName: values.firstName,
        patronymic: values.patronymic ?? null,
        phone: values.phone ?? null,
        email: values.email ?? null,
        role: values.role,
      },
      { onSuccess },
    );
  });

  return (
    <FormProvider {...form}>
      <form
        className="flex flex-col gap-5"
        noValidate
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <FormError message={updateMutation.error?.message} />

        <TextField fullWidth isReadOnly name="login">
          <Label>Логин</Label>
          <Input value={user.login} readOnly />
          <Description>Логин и пароль меняются отдельно</Description>
        </TextField>

        <UserProfileFields allowEmptyRole isRoleDisabled={isSelf} />

        <div className="mt-auto flex justify-end gap-3 pt-1">
          <Button
            type="submit"
            variant="primary"
            isPending={updateMutation.isPending}
            className="rounded-xl"
          >
            Сохранить
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}

interface UserDrawerProps {
  currentUserId?: string;
  state: UseOverlayStateReturn;
  user: UserDto | null;
}

export function UserDrawer({ currentUserId, state, user }: UserDrawerProps) {
  const title = user ? "Редактирование пользователя" : "Новый пользователь";

  return (
    <Drawer state={state}>
      <Drawer.Trigger className="hidden" />
      <Drawer.Backdrop>
        <Drawer.Content placement="right">
          <Drawer.Dialog
            aria-label={title}
            className="bg-surface flex h-full w-[min(480px,calc(100vw-24px))] flex-col p-0"
          >
            <Drawer.Header className="border-border flex-row items-center justify-between gap-3 border-b px-5 py-4">
              <div className="min-w-0">
                <Drawer.Heading className="text-base font-semibold">
                  {title}
                </Drawer.Heading>
                {user ? (
                  <p className="text-copy-muted mt-0.5 truncate text-xs">
                    @{user.login}
                  </p>
                ) : null}
              </div>
              <Drawer.CloseTrigger
                aria-label="Закрыть"
                className="absolute top-2.5 right-2.5 size-9 rounded-xl"
              >
                <UploadIcon className="size-4.5" name="close" />
              </Drawer.CloseTrigger>
            </Drawer.Header>
            <Drawer.Body className="mt-0 flex min-h-0 flex-1 flex-col">
              <ScrollShadow className="p-5">
                {user ? (
                  <EditUserForm
                    isSelf={user.id === currentUserId}
                    onSuccess={() => state.close()}
                    user={user}
                  />
                ) : (
                  <CreateUserForm onSuccess={() => state.close()} />
                )}
              </ScrollShadow>
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
