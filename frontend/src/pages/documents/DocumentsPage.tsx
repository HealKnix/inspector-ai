import {
  Button,
  Label,
  ListBox,
  SearchField,
  Select,
  Spinner,
  Table,
  useOverlayState,
} from "@heroui/react";
import { useState } from "react";

import {
  useAdminDocuments,
  useAdminObjects,
} from "@/api/hooks/use-admin-documents";
import { useUsers } from "@/api/hooks/use-users";
import type { AdminDocument } from "@/api/types/admin-documents";
import type { UserDto } from "@/api/types/auth";
import { ActionDropdown } from "@/components/action-dropdown/ActionDropdown";
import { UploadIcon, type UploadIconName } from "@/components/UploadIcon";
import { ConstrainedLayout, PageHeader } from "@/layouts/ConstrainedLayout";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { cn } from "@/lib/utils";
import routeNames from "@/routes/routeNames";

import { AdminDocumentViewer } from "./components/AdminDocumentViewer";

const ALL = "all";

const stateLabels: Record<
  NonNullable<AdminDocument["parsing"]>["state"],
  string
> = {
  queued: "В очереди",
  processing: "Обрабатывается",
  succeeded: "Обработан",
  failed: "Ошибка",
};

const formatIcons: Record<AdminDocument["format"], UploadIconName> = {
  PDF: "pdf",
  DOCX: "docx",
  XML: "xml",
};

function uploaderName(document: AdminDocument): string {
  const { last_name, first_name, patronymic, login } = document.uploaded_by;
  return [last_name, first_name, patronymic].filter(Boolean).join(" ") || login;
}

function userLabel(user: UserDto): string {
  const name = [user.lastName, user.firstName, user.patronymic]
    .filter(Boolean)
    .join(" ");
  return name ? `${name} · ${user.login}` : user.login;
}

export function DocumentsPage() {
  const [userFilter, setUserFilter] = useState<string>(ALL);
  const [objectFilter, setObjectFilter] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const [page, setPage] = useState(1);
  const [viewed, setViewed] = useState<AdminDocument | null>(null);
  const viewerState = useOverlayState();

  const query = useAdminDocuments({
    userId: userFilter === ALL ? undefined : userFilter,
    objectId: objectFilter === ALL ? undefined : objectFilter,
    q: debouncedSearch || undefined,
    page,
  });
  const usersQuery = useUsers();
  const objectsQuery = useAdminObjects();

  const data = query.isError ? undefined : query.data;
  const users = usersQuery.isError ? [] : (usersQuery.data ?? []);
  const objects = objectsQuery.isError ? [] : (objectsQuery.data?.items ?? []);
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  const selectFilter = (apply: (value: string) => void) => (value: unknown) => {
    if (typeof value === "string") {
      apply(value);
      setPage(1);
    }
  };

  const openViewer = (document: AdminDocument) => {
    setViewed(document);
    viewerState.open();
  };

  return (
    <ConstrainedLayout>
      <PageHeader
        backHref={routeNames.ROOT}
        description="Все загруженные документы с указанием пользователя и объекта. Доступен просмотр опубликованных результатов обработки."
        title="Документы"
      />

      <section
        className="border-border bg-card min-w-0 overflow-hidden rounded-[20px] border shadow-sm"
        aria-labelledby="documents-title"
      >
        <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-5 py-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold" id="documents-title">
              Все документы
            </h2>
            {data && (
              <span className="bg-accent/10 text-accent rounded-full px-3 py-1 text-xs font-medium">
                {data.total}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <SearchField
              aria-label="Поиск документов"
              className="w-64"
              onChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              value={search}
            >
              <Label className="sr-only">Поиск</Label>
              <SearchField.Group className="rounded-xl">
                <SearchField.SearchIcon />
                <SearchField.Input
                  placeholder="Файл, объект или пользователь…"
                  type="search"
                />
                <SearchField.ClearButton aria-label="Очистить поиск" />
              </SearchField.Group>
            </SearchField>
            <Select
              aria-label="Фильтр по пользователю"
              className="w-64"
              onChange={selectFilter(setUserFilter)}
              value={userFilter}
              variant="secondary"
            >
              <Label className="sr-only">Пользователь</Label>
              <Select.Trigger>
                <Select.Value className="max-w-full truncate" />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover className="not-sm:max-w-0">
                <ListBox>
                  <ListBox.Item
                    id={ALL}
                    textValue="Все пользователи"
                    className="data-selected:text-accent data-selected:bg-accent/10 flex gap-2 data-selected:[&>p]:pr-4"
                  >
                    <p className="min-w-0 flex-1 truncate">Все пользователи</p>
                    <ListBox.ItemIndicator className="text-accent" />
                  </ListBox.Item>
                  {users.map((user) => (
                    <ListBox.Item
                      id={user.id}
                      key={user.id}
                      textValue={userLabel(user)}
                      className="data-selected:text-accent data-selected:bg-accent/10 flex gap-2 data-selected:[&>p]:pr-4"
                    >
                      <p className="min-w-0 flex-1 truncate">
                        {userLabel(user)}
                      </p>
                      <ListBox.ItemIndicator className="text-accent" />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            <Select
              aria-label="Фильтр по объекту"
              className="w-64"
              onChange={selectFilter(setObjectFilter)}
              value={objectFilter}
              variant="secondary"
            >
              <Label className="sr-only">Объект</Label>
              <Select.Trigger>
                <Select.Value className="max-w-full truncate" />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover className="not-sm:max-w-0">
                <ListBox>
                  <ListBox.Item
                    id={ALL}
                    textValue="Все объекты"
                    className="data-selected:text-accent data-selected:bg-accent/10 flex gap-2 data-selected:[&>p]:pr-4"
                  >
                    <p className="min-w-0 flex-1 truncate">Все объекты</p>
                    <ListBox.ItemIndicator className="text-accent" />
                  </ListBox.Item>
                  {objects.map((object) => (
                    <ListBox.Item
                      id={object.id}
                      key={object.id}
                      textValue={object.name}
                      className="data-selected:text-accent data-selected:bg-accent/10 flex gap-2 data-selected:[&>p]:pr-4"
                    >
                      <p className="min-w-0 flex-1 truncate">{object.name}</p>
                      <ListBox.ItemIndicator className="text-accent" />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>
        </div>

        {query.isPending && (
          <p className="text-copy-muted p-10 text-center text-sm" role="status">
            <Spinner size="sm" /> Загружаем документы…
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
                aria-label="Документы сервиса"
                className="min-w-[980px]"
              >
                <Table.Header>
                  <Table.Column isRowHeader>Документ</Table.Column>
                  <Table.Column>Объект</Table.Column>
                  <Table.Column>Загрузил</Table.Column>
                  <Table.Column>Размер</Table.Column>
                  <Table.Column>Обработка</Table.Column>
                  <Table.Column>Загружен</Table.Column>
                  <Table.Column aria-label="Действия" className="w-0" />
                </Table.Header>
                <Table.Body
                  renderEmptyState={() => (
                    <div className="flex min-h-56 flex-col items-center justify-center px-5 text-center">
                      <UploadIcon
                        className="text-copy-muted mb-3 size-9"
                        name="file"
                      />
                      <h3 className="text-lg font-medium">
                        Документы не найдены
                      </h3>
                      <p className="text-copy-muted mt-2 text-sm">
                        Измените фильтры или загрузите документы в объекты.
                      </p>
                    </div>
                  )}
                >
                  {data.items.map((document) => {
                    const viewable = Boolean(
                      document.parsing?.state === "succeeded" &&
                      document.parsing.artifact_id,
                    );

                    return (
                      <Table.Row key={document.id}>
                        <Table.Cell>
                          <div className="flex items-center gap-3 py-2">
                            <UploadIcon
                              className="size-8 shrink-0"
                              name={formatIcons[document.format]}
                            />
                            <span className="min-w-0">
                              <span className="block max-w-72 truncate font-medium">
                                {document.original_name}
                              </span>
                              {document.integrity_error && (
                                <span className="text-danger block text-xs">
                                  Нарушена целостность оригинала
                                </span>
                              )}
                            </span>
                          </div>
                        </Table.Cell>
                        <Table.Cell className="text-copy-muted">
                          <span className="block max-w-56 truncate text-sm">
                            {document.object_name}
                          </span>
                        </Table.Cell>
                        <Table.Cell>
                          <span className="block max-w-56 truncate text-sm">
                            {uploaderName(document)}
                          </span>
                          <span className="text-copy-muted block max-w-56 truncate text-xs">
                            {document.uploaded_by.login}
                          </span>
                        </Table.Cell>
                        <Table.Cell className="text-copy-muted whitespace-nowrap">
                          {(document.size / 1_000_000).toLocaleString("ru-RU", {
                            maximumFractionDigits: 2,
                          })}{" "}
                          МБ
                        </Table.Cell>
                        <Table.Cell>
                          <span
                            className={cn(
                              "inline-block rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap",
                              document.parsing?.state === "failed"
                                ? "bg-danger/10 text-danger"
                                : document.parsing?.state === "succeeded"
                                  ? "bg-success/10 text-foreground"
                                  : "bg-surface-high text-copy-muted",
                            )}
                          >
                            {document.parsing
                              ? stateLabels[document.parsing.state]
                              : "Не обрабатывался"}
                          </span>
                        </Table.Cell>
                        <Table.Cell className="text-copy-muted whitespace-nowrap">
                          {new Date(document.created_at).toLocaleDateString(
                            "ru-RU",
                          )}
                        </Table.Cell>
                        <Table.Cell className="text-center">
                          <ActionDropdown
                            ariaLabel={`Действия с документом ${document.original_name}`}
                            actions={[
                              {
                                label: "Просмотр",
                                icon: (
                                  <UploadIcon className="size-4" name="eye" />
                                ),
                                isDisabled: !viewable,
                                onPress: () => openViewer(document),
                              },
                            ]}
                          />
                        </Table.Cell>
                      </Table.Row>
                    );
                  })}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        )}
        {data && totalPages > 1 && (
          <div className="border-border flex items-center justify-between gap-3 border-t px-5 py-3">
            <Button
              className="rounded-xl"
              isDisabled={page <= 1}
              size="sm"
              variant="outline"
              onPress={() => setPage(page - 1)}
            >
              Назад
            </Button>
            <span className="text-copy-muted text-xs tabular-nums">
              Страница {data.page} из {totalPages}
            </span>
            <Button
              className="rounded-xl"
              isDisabled={page >= totalPages}
              size="sm"
              variant="outline"
              onPress={() => setPage(page + 1)}
            >
              Вперёд
            </Button>
          </div>
        )}
      </section>

      <AdminDocumentViewer
        document={viewed}
        key={viewed?.id ?? "empty"}
        state={viewerState}
      />
    </ConstrainedLayout>
  );
}
