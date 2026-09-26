import { Button } from "@heroui/react";
import { Link, useSearchParams } from "react-router-dom";

import { useObjects } from "@/api/hooks/use-objects";
import { ConstrainedLayout, PageHeader } from "@/layouts/ConstrainedLayout";
import routeNames from "@/routes/routeNames";

export function VerificationObjectIndex() {
  const [params, setParams] = useSearchParams();
  const requested = Number(params.get("page"));
  const page = Number.isSafeInteger(requested) && requested > 0 ? requested : 1;
  const query = useObjects(page);
  const data = query.isError ? undefined : query.data;
  const changePage = (next: number) => setParams({ page: String(next) });

  return (
    <ConstrainedLayout>
      <PageHeader
        title="Проверки объектов"
        description="Выберите объект, чтобы открыть документы и результаты проверки."
      />
      <section className="border-border bg-card space-y-4 rounded-2xl border p-5">
        {query.isPending ? <p role="status">Загружаем объекты…</p> : null}
        {query.isError ? (
          <div role="alert">
            <p>{query.error.message}</p>
            <Button onPress={() => void query.refetch()}>Повторить</Button>
          </div>
        ) : null}
        {data?.items.map((object) => (
          <Link
            className="border-border hover:text-accent block rounded-xl border p-4"
            key={object.id}
            to={routeNames.DOCUMENT_VERIFICATION_DETAILS(object.id)}
          >
            {object.name}
          </Link>
        ))}
        {data && data.items.length === 0 ? (
          <p>
            Доступных объектов пока нет.{" "}
            <Link className="text-accent underline" to={routeNames.OBJECTS}>
              Перейти к объектам
            </Link>
          </p>
        ) : null}
        {data && data.total > data.limit ? (
          <div className="flex items-center justify-end gap-3">
            <Button isDisabled={page <= 1} onPress={() => changePage(page - 1)}>
              Назад
            </Button>
            <span>Страница {page}</span>
            <Button
              isDisabled={page * data.limit >= data.total}
              onPress={() => changePage(page + 1)}
            >
              Далее
            </Button>
          </div>
        ) : null}
      </section>
    </ConstrainedLayout>
  );
}
