import { Button, Disclosure, Spinner } from "@heroui/react";
import { useState } from "react";

import {
  completenessErrorMessage,
  useCompletenessResult,
  useConfirmPackage,
  useEvaluateCompleteness,
  useExpectedPackage,
  useGeneratePackage,
} from "@/api/hooks/use-completeness";
import type { IdentificationRegistry } from "@/api/types/identification";

const stages = [
  { stage: "PD", label: "ПД" },
  { stage: "RD", label: "РД" },
  { stage: "ID", label: "ИД" },
] as const;

export function CompletenessPanel({
  objectId,
  registry,
  canEdit = false,
}: {
  objectId: string;
  registry?: IdentificationRegistry;
  canEdit?: boolean;
}) {
  const packageQuery = useExpectedPackage(objectId);
  const resultQuery = useCompletenessResult(
    objectId,
    registry?.run_id,
    Boolean(registry?.current && !registry.active),
    registry?.resolved_input_hash,
  );
  const generate = useGeneratePackage(objectId);
  const confirm = useConfirmPackage(objectId);
  const evaluate = useEvaluateCompleteness(objectId);
  const [confirmation, setConfirmation] = useState<{
    version: number;
    requestId: string;
  } | null>(null);
  const pkg = packageQuery.isError
    ? null
    : (packageQuery.data?.package ?? null);
  const result = resultQuery.isError ? undefined : resultQuery.data;
  const current =
    registry?.current &&
    !registry.active &&
    pkg?.status === "confirmed" &&
    result?.package_version === pkg.version &&
    result?.run_id === registry.run_id &&
    result.resolved_input_hash === registry.resolved_input_hash;
  const evaluation = current ? result?.evaluation : undefined;
  const missing =
    evaluation?.requirements.filter((item) => item.outcome === "missing") ?? [];
  const uncertain =
    evaluation?.requirements.filter(
      (item) => item.outcome === "unverifiable",
    ) ?? [];
  const confirmationBasis = "Подтверждаю состав комплекта для этого объекта.";
  const error =
    packageQuery.error ??
    resultQuery.error ??
    generate.error ??
    confirm.error ??
    evaluate.error;

  const confirmComposition = () => {
    if (!pkg) return;
    const requestId =
      confirmation?.version === pkg.version
        ? confirmation.requestId
        : crypto.randomUUID();
    setConfirmation({ version: pkg.version, requestId });
    confirm.mutate(
      {
        requestId,
        expectedVersion: pkg.version,
        basis: confirmationBasis,
        attributes: pkg.attributes,
        exclude: pkg.requirements
          .filter((item) => item.excluded)
          .map((item) => ({
            requirement_id: item.id,
            reason: item.exclusion_reason ?? "",
          })),
      },
      {
        onSuccess: () => {
          if (registry?.current && !registry.active)
            evaluate.mutate(registry.run_id);
        },
      },
    );
  };

  return (
    <section className="border-border bg-card rounded-[20px] border p-5 shadow-sm sm:p-6">
      <h2 className="text-lg font-semibold">Комплектность</h2>
      {packageQuery.isPending ||
      (registry?.active && pkg?.status === "confirmed") ? (
        <p
          className="text-copy-muted mt-4 flex items-center gap-2 text-sm"
          role="status"
        >
          <Spinner size="sm" /> Проверяем состав комплекта…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-danger mt-4 text-sm">
          {completenessErrorMessage(error)}
        </p>
      ) : null}
      {packageQuery.isError ? (
        <Button
          className="mt-3 rounded-xl"
          size="sm"
          variant="outline"
          onPress={() => void packageQuery.refetch()}
        >
          Повторить
        </Button>
      ) : null}
      {packageQuery.data && !pkg ? (
        <div className="mt-4">
          <p className="text-copy-muted text-sm leading-6">
            Состав комплекта ещё не задан. Пока нельзя определить, каких
            документов не хватает.
          </p>
          <Button
            className="mt-3 rounded-xl"
            isPending={generate.isPending}
            isDisabled={!canEdit}
            size="sm"
            variant="outline"
            onPress={() => generate.mutate({ attributes: {} })}
          >
            Сформировать состав
          </Button>
        </div>
      ) : null}
      {pkg ? (
        <>
          {evaluation ? (
            <>
              <dl className="divide-border mt-4 divide-y">
                {stages.map(({ stage, label }) => {
                  const status = evaluation.stages[stage];
                  return (
                    <div
                      className="flex items-center justify-between gap-3 py-3"
                      key={stage}
                    >
                      <dt className="font-semibold">{label}</dt>
                      <dd className="text-copy-muted text-sm">
                        {status
                          ? `Подтверждено ${status.fulfilled} из ${status.applicable}`
                          : "Состав не определён"}
                      </dd>
                    </div>
                  );
                })}
              </dl>
              <p className="mt-3 text-sm leading-6" role="status">
                {evaluation.counts.missing === 0 &&
                evaluation.counts.unverifiable === 0
                  ? "Документы по подтверждённому составу загружены."
                  : `Не хватает документов по ${evaluation.counts.missing} требованиям. Требуют уточнения: ${evaluation.counts.unverifiable}.`}
              </p>
              {missing.length || uncertain.length ? (
                <Disclosure className="mt-3">
                  <Disclosure.Heading>
                    <Disclosure.Trigger className="text-accent text-sm">
                      Что ещё нужно
                      <Disclosure.Indicator />
                    </Disclosure.Trigger>
                  </Disclosure.Heading>
                  <Disclosure.Content>
                    <ul className="text-copy-muted mt-3 space-y-2 text-sm">
                      {missing.map((item) => (
                        <li key={item.requirement_id}>
                          {item.title} — загрузите документ
                        </li>
                      ))}
                      {uncertain.map((item) => (
                        <li key={item.requirement_id}>
                          {item.title} — уточните сведения в загруженных
                          документах
                        </li>
                      ))}
                    </ul>
                  </Disclosure.Content>
                </Disclosure>
              ) : null}
            </>
          ) : !registry?.active ? (
            <p className="text-copy-muted mt-4 text-sm leading-6">
              {pkg.status === "proposed"
                ? "Проверьте предложенный состав. После подтверждения система покажет недостающие документы."
                : "Комплектность ещё не определена. Это не означает, что документы отсутствуют."}
            </p>
          ) : null}
          <Disclosure className="mt-4">
            <Disclosure.Heading>
              <Disclosure.Trigger className="text-accent text-sm">
                {pkg.status === "proposed"
                  ? "Проверить состав комплекта"
                  : "Ожидаемые документы"}
                <Disclosure.Indicator />
              </Disclosure.Trigger>
            </Disclosure.Heading>
            <Disclosure.Content>
              <ul className="text-copy-muted mt-3 space-y-2 text-sm">
                {pkg.requirements
                  .filter((item) => !item.excluded)
                  .map((item) => (
                    <li key={item.id}>
                      {item.title}
                      {item.quantity.min > 1
                        ? ` — не менее ${item.quantity.min}`
                        : ""}
                    </li>
                  ))}
              </ul>
              {pkg.status === "proposed" ? (
                <>
                  <p className="mt-4 text-sm">{confirmationBasis}</p>
                  <Button
                    className="mt-3 rounded-xl"
                    size="sm"
                    isPending={confirm.isPending || evaluate.isPending}
                    isDisabled={!canEdit || registry?.active}
                    onPress={confirmComposition}
                  >
                    Подтвердить состав
                  </Button>
                </>
              ) : null}
            </Disclosure.Content>
          </Disclosure>
          {!evaluation &&
          pkg.status === "confirmed" &&
          registry?.current &&
          !registry.active ? (
            <Button
              className="mt-3 rounded-xl"
              size="sm"
              variant="outline"
              isPending={evaluate.isPending}
              isDisabled={!registry.allowed_actions.apply}
              onPress={() => evaluate.mutate(registry.run_id)}
            >
              Обновить комплектность
            </Button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
