import { Avatar, Button, Spinner, Table, useOverlayState } from "@heroui/react";
import { useState } from "react";

import { useUsers } from "@/api/hooks/use-users";
import { Role, roleLabels, type UserDto } from "@/api/types/auth";
import { UploadIcon } from "@/components/UploadIcon";
import { ConstrainedLayout, PageHeader } from "@/layouts/ConstrainedLayout";
import { fallbackAvatars } from "@/lib/fallback-avatars";
import { cn } from "@/lib/utils";
import routeNames from "@/routes/routeNames";
import { useAuthSessionStore } from "@/store/auth-session";
import { UserDrawer } from "./components/UserDrawer";

const roleFilters: readonly (Role | null)[] = [
  null,
  Role.INSPECTOR,
  Role.ADMINISTRATOR,
  Role.ML_ENGINEER,
];

function fullName(user: UserDto): string {
  return (
    [user.lastName, user.firstName, user.patronymic]
      .filter(Boolean)
      .join(" ") || user.login
  );
}

export function UsersPage() {
  const query = useUsers();
  const data = query.isError ? undefined : query.data;
  const currentUserId = useAuthSessionStore((state) => state.user?.id);
  const [roleFilter, setRoleFilter] = useState<Role | null>(null);
  const [editedUser, setEditedUser] = useState<UserDto | null>(null);
  const drawerState = useOverlayState();

  const users = data ?? [];
  const filteredUsers =
    roleFilter === null
      ? users
      : users.filter((user) => user.role === roleFilter);

  const openCreate = () => {
    setEditedUser(null);
    drawerState.open();
  };

  const openEdit = (user: UserDto) => {
    setEditedUser(user);
    drawerState.open();
  };

  return (
    <ConstrainedLayout>
      <PageHeader
        actions={
          <Button
            className="self-start rounded-xl sm:self-end"
            variant="primary"
            onPress={openCreate}
          >
            <UploadIcon className="size-4.5" name="plus" />
            Создать пользователя
          </Button>
        }
        backHref={routeNames.ROOT}
        description="Учётные записи сервиса: роли и контактные данные инспекторов, администраторов и ML-инженеров."
        title="Пользователи"
      />

      <section
        className="border-border bg-card min-w-0 overflow-hidden rounded-[20px] border shadow-sm"
        aria-labelledby="users-title"
      >
        <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-5 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold" id="users-title">
              Все пользователи
            </h2>
            {data && (
              <span className="bg-accent/10 text-accent rounded-full px-3 py-1 text-xs font-medium">
                {filteredUsers.length} из {users.length}
              </span>
            )}
          </div>
          <div
            aria-label="Фильтр по роли"
            className="flex flex-wrap gap-2"
            role="group"
          >
            {roleFilters.map((role) => {
              const isActive = roleFilter === role;
              return (
                <Button
                  key={role ?? "all"}
                  aria-pressed={isActive}
                  className={cn(
                    "rounded-xl",
                    isActive &&
                      "bg-accent/10 text-accent data-[hovered=true]:bg-accent/15",
                  )}
                  size="sm"
                  variant={isActive ? "secondary" : "outline"}
                  onPress={() => setRoleFilter(role)}
                >
                  {role === null ? "Все роли" : roleLabels[role]}
                </Button>
              );
            })}
          </div>
        </div>

        {query.isPending && (
          <p className="text-copy-muted p-10 text-center text-sm" role="status">
            <Spinner size="sm" /> Загружаем пользователей…
          </p>
        )}
        {query.error && (
          <div className="space-y-3 p-6" role="alert">
            <p className="text-danger font-medium">{query.error.message}</p>
            <Button
              className="rounded-xl"
              variant="outline"
              onPress={() => {
                void query.refetch();
              }}
            >
              Повторить
            </Button>
          </div>
        )}
        {data && (
          <Table className="rounded-none border-0 shadow-none">
            <Table.ScrollContainer>
              <Table.Content
                aria-label="Пользователи сервиса"
                className="min-w-[760px]"
              >
                <Table.Header>
                  <Table.Column isRowHeader>Пользователь</Table.Column>
                  <Table.Column>Роль</Table.Column>
                  <Table.Column>Контакты</Table.Column>
                  <Table.Column>Создан</Table.Column>
                  <Table.Column aria-label="Действия" />
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <div className="flex min-h-56 flex-col items-center justify-center px-5 text-center">
                      <UploadIcon
                        className="text-copy-muted mb-3 size-9"
                        name="user"
                      />
                      <h3 className="text-lg font-medium">
                        {users.length === 0
                          ? "Пока нет пользователей"
                          : "Нет пользователей с такой ролью"}
                      </h3>
                      <p className="text-copy-muted mt-2 text-sm">
                        {users.length === 0
                          ? "Создайте первую учётную запись."
                          : "Измените фильтр, чтобы увидеть других пользователей."}
                      </p>
                    </div>
                  )}
                >
                  {filteredUsers.map((user) => {
                    const randomNumberFromId = Array.from(
                      user?.id ?? "",
                    ).reduce((acc, curr) => {
                      return acc + (!isNaN(+curr) ? +curr : 0);
                    }, 0);

                    return (
                      <Table.Row key={user.id}>
                        <Table.Cell>
                          <div className="flex items-center gap-3 py-2">
                            <Avatar>
                              <Avatar.Image
                                src={
                                  fallbackAvatars[
                                    randomNumberFromId % fallbackAvatars.length
                                  ]
                                }
                              />
                            </Avatar>
                            <span className="min-w-0">
                              <span className="block max-w-64 truncate font-medium">
                                {fullName(user)}
                              </span>
                              <span className="text-copy-muted block max-w-64 truncate text-xs">
                                {user.login}
                              </span>
                            </span>
                          </div>
                        </Table.Cell>
                        <Table.Cell>
                          <span className="bg-accent/10 text-accent inline-block rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap">
                            {user.role
                              ? roleLabels[user.role]
                              : "Роль не назначена"}
                          </span>
                        </Table.Cell>
                        <Table.Cell className="text-copy-muted">
                          <span className="block max-w-56 truncate text-sm">
                            {user.phone ?? "—"}
                          </span>
                          <span className="block max-w-56 truncate text-xs">
                            {user.email ?? ""}
                          </span>
                        </Table.Cell>
                        <Table.Cell className="text-copy-muted whitespace-nowrap">
                          {new Date(user.createdAt).toLocaleDateString("ru-RU")}
                        </Table.Cell>
                        <Table.Cell>
                          <Button
                            aria-label={`Изменить пользователя ${user.login}`}
                            className="rounded-xl"
                            size="sm"
                            variant="outline"
                            onPress={() => openEdit(user)}
                          >
                            Изменить
                          </Button>
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        )}
      </section>

      <UserDrawer
        currentUserId={currentUserId}
        state={drawerState}
        user={editedUser}
      />
    </ConstrainedLayout>
  );
}
