import {
  identificationErrorMessage,
  useIdentification,
} from "@/api/hooks/use-identification";
import { ConstrainedLayout, PageHeader } from "@/layouts/ConstrainedLayout";
import routeNames from "@/routes/routeNames";
import { Button } from "@heroui/react";
import { useParams, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { RegistryWorkspace } from "./components/RegistryWorkspace";

const uuid = z.uuid();
export function IdentificationPage() {
  const { objectId = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const processId = params.get("processId") ?? "";
  const runId = params.get("runId") ?? undefined;
  const hash = params.get("resolvedInputHash") ?? undefined;
  const valid =
    uuid.safeParse(processId).success &&
    (!runId || uuid.safeParse(runId).success) &&
    (!hash || /^[a-f0-9]{64}$/.test(hash));
  const query = useIdentification(
    objectId,
    valid ? processId : "",
    runId,
    hash,
  );
  const registry = query.data;
  return (
    <ConstrainedLayout>
      <PageHeader
        title="Документы и редакции"
        backHref={routeNames.OBJECT_UPLOAD(objectId)}
        backLabel="К документам объекта"
        description="Сверьте реквизиты с оригиналом. Связи для сравнения система подберёт сама."
      />
      {!valid ? (
        <p role="alert" className="py-6">
          Откройте документы из страницы объекта после загрузки.
        </p>
      ) : query.isPending ? (
        <p role="status" className="py-6">
          Загружаем документы…
        </p>
      ) : registry?.object_id === objectId ? (
        <>
          {query.error ? (
            <p role="alert" className="my-3 text-sm">
              Не удалось обновить данные. Введённые значения сохранены на
              экране.
            </p>
          ) : null}
          <RegistryWorkspace
            key={`${processId}:${runId ?? "current"}:${hash ?? "latest"}`}
            objectId={objectId}
            registry={registry}
            params={params}
            onParams={setParams}
            unavailable={query.isError}
            onReload={async () => {
              const result = await query.refetch();
              return !result.isError;
            }}
          />
        </>
      ) : (
        <div role="alert" className="space-y-3 py-6">
          <p>
            {query.error
              ? identificationErrorMessage(query.error)
              : "Документы не относятся к выбранному объекту."}
          </p>
          <Button onPress={() => void query.refetch()}>
            Повторить загрузку
          </Button>
        </div>
      )}
    </ConstrainedLayout>
  );
}
