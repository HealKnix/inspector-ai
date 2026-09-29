import { Button, Table } from "@heroui/react";
import { Link, useSearchParams } from "react-router-dom";

import { useObjects } from "@/api/hooks/use-objects";
import { UploadIcon } from "@/components/UploadIcon";
import { ConstrainedLayout, PageHeader } from "@/layouts/ConstrainedLayout";
import routeNames from "@/routes/routeNames";
import { CreateObjectForm } from "./components/CreateObjectForm";

export function ObjectsPage() {
  const [params, setParams] = useSearchParams();
  const requestedPage = Number(params.get("page"));
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1;
  const query = useObjects(page);
  const data = query.isError ? undefined : query.data;

  return (
    <ConstrainedLayout>
      <PageHeader
        backHref={routeNames.ROOT}
        description="Выберите объект, чтобы загрузить документы и открыть сохранённые оригиналы."
        title="Объекты строительства"
      />

      <div className="grid items-stretch gap-4 lg:grid-cols-3">
        <section
          className="bg-accent text-accent-foreground flex min-h-60 flex-col rounded-[25px] p-6 sm:p-7"
          aria-label="Доступные объекты"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium">Доступно объектов</h2>
            <span className="bg-accent-foreground/15 grid size-10 place-items-center rounded-xl">
              <UploadIcon className="size-5" name="folder" />
            </span>
          </div>
          <strong className="mt-6 text-6xl leading-none font-normal tracking-[-0.045em]">
            {data?.total ?? "—"}
          </strong>
          <p className="text-accent-foreground/75 mt-4 text-sm leading-6">
            Проектная, рабочая и исполнительная документация в одном месте.
          </p>
        </section>
        <div className="min-w-0 lg:col-span-2">
          {data?.allowed_actions.includes("create") ? (
            <CreateObjectForm />
          ) : (
            <section className="border-border bg-card flex h-full flex-col justify-center rounded-[25px] border p-6 sm:p-7">
              <UploadIcon className="text-accent mb-4 size-7" name="layers" />
              <h2 className="text-lg font-semibold">Документы по объектам</h2>
              <p className="text-copy-muted mt-2 max-w-lg text-sm leading-6">
                Здесь отображаются объекты, на которые у вас есть назначение. В
                карточке каждого объекта собраны его оригиналы документов.
              </p>
            </section>
          )}
        </div>
      </div>

      <section
        className="border-border bg-card min-w-0 overflow-hidden rounded-[20px] border shadow-sm"
        aria-labelledby="objects-title"
      >
        <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-5 py-5">
          <h2 className="text-lg font-semibold" id="objects-title">
            Все объекты
          </h2>
          {data && (
            <span className="bg-accent/10 text-accent rounded-full px-3 py-1 text-xs font-medium">
              Всего {data.total}
            </span>
          )}
        </div>
        {query.isPending && (
          <p className="text-copy-muted p-10 text-center text-sm" role="status">
            Загружаем объекты…
          </p>
        )}
        {query.error && (
          <div className="space-y-3 p-6" role="alert">
            <p className="text-danger font-medium">{query.error.message}</p>
            <p className="text-copy-muted text-sm">
              Для работы с документами нужна роль инспектора и назначение на
              объект.
            </p>
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
          <>
            <Table className="rounded-none border-0 shadow-none">
              <Table.ScrollContainer>
                <Table.Content
                  aria-label="Объекты строительства"
                  className="min-w-[620px]"
                >
                  <Table.Header>
                    <Table.Column isRowHeader>Название объекта</Table.Column>
                    <Table.Column>Создан</Table.Column>
                    <Table.Column>Обновлён</Table.Column>
                    <Table.Column aria-label="Открыть объект" />
                  </Table.Header>
                  <Table.Body
                    renderEmptyState={() => (
                      <div className="flex min-h-56 flex-col items-center justify-center px-5 text-center">
                        <UploadIcon
                          className="text-copy-muted mb-3 size-9"
                          name="folder"
                        />
                        <h3 className="text-lg font-medium">
                          {data.total === 0
                            ? "Пока нет объектов"
                            : "На этой странице нет объектов"}
                        </h3>
                        <p className="text-copy-muted mt-2 text-sm">
                          {data.allowed_actions.includes("create") &&
                          data.total === 0
                            ? "Создайте первый объект, чтобы загрузить документы."
                            : "Доступные объекты появятся в этом списке."}
                        </p>
                      </div>
                    )}
                  >
                    {data.items.map((object) => (
                      <Table.Row key={object.id}>
                        <Table.Cell>
                          <Link
                            className="hover:text-accent flex items-center gap-3 py-2 font-medium"
                            to={routeNames.OBJECT_UPLOAD(object.id)}
                          >
                            <span className="bg-accent/10 text-accent grid size-10 shrink-0 place-items-center rounded-xl">
                              <UploadIcon className="size-5" name="folder" />
                            </span>
                            <span className="max-w-md break-words">
                              {object.name}
                            </span>
                          </Link>
                        </Table.Cell>
                        <Table.Cell className="text-copy-muted whitespace-nowrap">
                          {new Date(object.created_at).toLocaleDateString(
                            "ru-RU",
                          )}
                        </Table.Cell>
                        <Table.Cell className="text-copy-muted whitespace-nowrap">
                          {new Date(object.updated_at).toLocaleDateString(
                            "ru-RU",
                          )}
                        </Table.Cell>
                        <Table.Cell>
                          <Link
                            aria-label={`Открыть объект: ${object.name}`}
                            className="text-accent inline-flex items-center gap-1 text-sm font-medium whitespace-nowrap"
                            to={routeNames.OBJECT_UPLOAD(object.id)}
                          >
                            Открыть{" "}
                            <UploadIcon
                              className="size-4"
                              name="chevron-right"
                            />
                          </Link>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
            {data.total > data.limit && (
              <div className="border-border flex flex-wrap items-center justify-end gap-3 border-t px-5 py-4">
                <span className="text-copy-muted mr-auto text-sm">
                  Страница {page} из {Math.ceil(data.total / data.limit)}
                </span>
                <Button
                  className="rounded-xl"
                  size="sm"
                  variant="outline"
                  isDisabled={page <= 1}
                  onPress={() => setParams({ page: String(page - 1) })}
                >
                  Назад
                </Button>
                <Button
                  className="rounded-xl"
                  size="sm"
                  variant="outline"
                  isDisabled={page * data.limit >= data.total}
                  onPress={() => setParams({ page: String(page + 1) })}
                >
                  Далее
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </ConstrainedLayout>
  );
}
