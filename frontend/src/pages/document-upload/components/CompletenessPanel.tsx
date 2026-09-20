import {
  Button,
  Checkbox,
  Input,
  Label,
  TextArea,
  TextField,
} from "@heroui/react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import {
  completenessErrorMessage,
  useCompletenessResult,
  useConfirmPackage,
  useEvaluateCompleteness,
  useExpectedPackage,
  useGeneratePackage,
} from "@/api/hooks/use-completeness";
import type { ExpectedPackage } from "@/api/types/completeness";
import { AttributesEditor } from "@/components/AttributesEditor";
import {
  draftFromAttributes,
  draftToAttributes,
  type AttributesDraft,
} from "@/components/attributes-draft";
import {
  listKindLabels,
  outcomeLabels,
  outcomeReasonLabel,
  scenarioLabels,
  stageLabels,
  stageStatusLabels,
} from "./completeness-labels";

function StageChip({ stage, status }: { stage: string; status: string }) {
  return (
    <span className="bg-surface-high text-copy-muted inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs">
      {stageLabels[stage] ?? stage}: {stageStatusLabels[status] ?? status}
    </span>
  );
}

export function CompletenessPanel({ objectId }: { objectId: string }) {
  const [params, setParams] = useSearchParams();
  const selectedRunId = params.get("run") ?? undefined;
  const packageQuery = useExpectedPackage(objectId);
  const resultQuery = useCompletenessResult(objectId, selectedRunId);
  const generate = useGeneratePackage(objectId);
  const confirm = useConfirmPackage(objectId);
  const evaluate = useEvaluateCompleteness(objectId);
  const pack: ExpectedPackage | null | undefined = packageQuery.isError
    ? undefined
    : packageQuery.data?.package;
  const [draft, setDraft] = useState<AttributesDraft | null>(null);
  const [basis, setBasis] = useState("");
  const [exclusions, setExclusions] = useState<Record<string, string>>({});
  const attributesDraft = draft ?? draftFromAttributes(pack?.attributes ?? {});
  const evaluation = resultQuery.isError
    ? undefined
    : resultQuery.data?.evaluation;
  const result = resultQuery.data;

  function toggleExclusion(requirementId: string, selected: boolean) {
    setExclusions((current) => {
      const next = { ...current };
      if (selected) next[requirementId] = "";
      else delete next[requirementId];
      return next;
    });
  }

  const excludedIds = Object.keys(exclusions);
  const exclusionsReady =
    excludedIds.length === 0 ||
    excludedIds.every((id) => exclusions[id]?.trim());
  const canConfirm =
    pack?.status === "proposed" && basis.trim().length > 0 && exclusionsReady;

  return (
    <section
      className="border-border bg-card overflow-hidden rounded-[20px] border"
      aria-labelledby="completeness-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-5">
        <div>
          <h2 id="completeness-title" className="text-lg font-semibold">
            Комплектность документации
          </h2>
          <p className="text-copy-muted mt-1 text-xs leading-5">
            Ожидаемый состав утверждается инспектором; расчёт выполняется по
            подтверждённой версии перечня.
          </p>
        </div>
        {pack && (
          <span className="bg-surface-high text-copy-muted rounded-full px-3 py-1 text-xs">
            Перечень v{pack.version} ·{" "}
            {pack.status === "confirmed" ? "подтверждён" : "предложение"} ·
            каркас v{pack.framework_version}
          </span>
        )}
      </div>
      {packageQuery.isPending && (
        <p role="status" className="text-copy-muted px-5 pb-5 text-sm">
          Загружаем ожидаемый состав…
        </p>
      )}
      {packageQuery.error && (
        <div role="alert" className="space-y-3 px-5 pb-5">
          <p className="text-danger text-sm">
            {completenessErrorMessage(packageQuery.error)}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="rounded-xl"
            onPress={() => {
              void packageQuery.refetch();
            }}
          >
            Повторить
          </Button>
        </div>
      )}
      {packageQuery.data && !pack && (
        <div className="space-y-4 px-5 pb-5">
          <p className="text-copy-muted text-sm">
            Ожидаемый состав ещё не сформирован. Заполните атрибуты объекта —
            система соберёт предложение из утверждённого нормативного каркаса и
            перечней, найденных в документах.
          </p>
          <AttributesEditor draft={attributesDraft} onChange={setDraft} />
          {generate.error && (
            <p role="alert" className="text-danger text-sm">
              {completenessErrorMessage(generate.error)}
            </p>
          )}
          <Button
            className="rounded-xl"
            isPending={generate.isPending}
            onPress={() =>
              generate.mutate({
                attributes: draftToAttributes(attributesDraft),
              })
            }
          >
            Сформировать предложение
          </Button>
        </div>
      )}
      {pack && (
        <div className="space-y-5 px-5 pb-5">
          <AttributesEditor draft={attributesDraft} onChange={setDraft} />
          {pack.list_items.length > 0 && (
            <div>
              <h3 className="text-sm font-medium">
                Объектные перечни ({pack.list_items.length})
              </h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {pack.list_items.map((item) => (
                  <li
                    key={item.id}
                    className="bg-surface-high rounded-full px-3 py-1 text-xs"
                    title={
                      typeof item.source?.["quote"] === "string"
                        ? `Источник: ${item.source["quote"]}`
                        : undefined
                    }
                  >
                    {listKindLabels[item.list_kind] ?? item.list_kind}:{" "}
                    {item.title}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h3 className="text-sm font-medium">
              Требования ({pack.requirements_total})
            </h3>
            <ul className="divide-border mt-2 divide-y">
              {pack.requirements.map((requirement) => {
                const excluded =
                  requirement.id in exclusions || requirement.excluded;
                return (
                  <li key={requirement.id} className="py-3">
                    <div className="flex flex-wrap items-start gap-3">
                      <span className="bg-surface-high rounded px-2 py-0.5 text-xs font-medium">
                        {requirement.stage}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm break-words">
                          {requirement.title}
                        </p>
                        <p className="text-copy-muted mt-0.5 text-xs">
                          {requirement.code} · мин. {requirement.quantity.min}
                          {requirement.source?.norm_ref
                            ? ` · ${requirement.source.norm_ref}`
                            : ""}
                          {requirement.origin === "manual"
                            ? " · добавлено инспектором"
                            : ""}
                        </p>
                      </div>
                      {pack.status === "proposed" && !requirement.excluded && (
                        <Checkbox
                          aria-label={`Исключить ${requirement.title}`}
                          isSelected={excluded}
                          onChange={(selected) =>
                            toggleExclusion(requirement.id, selected)
                          }
                          variant="secondary"
                        >
                          <Checkbox.Content>
                            <Checkbox.Control>
                              <Checkbox.Indicator />
                            </Checkbox.Control>
                            <span className="text-xs">исключить</span>
                          </Checkbox.Content>
                        </Checkbox>
                      )}
                      {requirement.excluded && (
                        <span className="text-copy-muted text-xs">
                          исключено
                          {requirement.exclusion_reason
                            ? `: ${requirement.exclusion_reason}`
                            : ""}
                        </span>
                      )}
                    </div>
                    {requirement.id in exclusions && (
                      <TextField className="mt-2 w-full">
                        <Label>Причина исключения</Label>
                        <Input
                          placeholder="Причина исключения (обязательно)"
                          value={exclusions[requirement.id] ?? ""}
                          onChange={(event) =>
                            setExclusions((current) => ({
                              ...current,
                              [requirement.id]: event.target.value,
                            }))
                          }
                        />
                      </TextField>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          {pack.status === "proposed" && (
            <div className="border-border space-y-3 border-t pt-4">
              <TextField className="w-full">
                <Label>Основание подтверждения</Label>
                <TextArea
                  placeholder="Основание подтверждения состава (обязательно)"
                  value={basis}
                  onChange={(event) => setBasis(event.target.value)}
                />
              </TextField>
              {confirm.error && (
                <p role="alert" className="text-danger text-sm">
                  {completenessErrorMessage(confirm.error)}
                </p>
              )}
              <Button
                className="rounded-xl"
                isDisabled={!canConfirm}
                isPending={confirm.isPending}
                onPress={() =>
                  confirm.mutate({
                    requestId: crypto.randomUUID(),
                    expectedVersion: pack.version,
                    basis: basis.trim(),
                    attributes: draftToAttributes(attributesDraft),
                    exclude: excludedIds.map((id) => ({
                      requirement_id: id,
                      reason: exclusions[id]?.trim() ?? "",
                    })),
                  })
                }
              >
                Подтвердить состав v{pack.version}
              </Button>
            </div>
          )}
          {pack.status === "confirmed" && (
            <div className="border-border space-y-3 border-t pt-4">
              <p className="text-copy-muted text-xs">
                Подтверждён {pack.confirmed_by ?? "инспектором"}
                {pack.confirmed_at
                  ? ` ${new Date(pack.confirmed_at).toLocaleString("ru-RU")}`
                  : ""}
                {pack.basis ? ` · основание: ${pack.basis}` : ""}
              </p>
              {evaluate.error && (
                <p role="alert" className="text-danger text-sm">
                  {completenessErrorMessage(evaluate.error)}
                </p>
              )}
              <Button
                className="rounded-xl"
                variant="outline"
                isPending={evaluate.isPending}
                onPress={() =>
                  evaluate.mutate(selectedRunId, {
                    onSuccess: (data) => {
                      if (data.run_id)
                        setParams((current) => {
                          current.set("run", data.run_id!);
                          return current;
                        });
                    },
                  })
                }
              >
                Рассчитать комплектность
              </Button>
            </div>
          )}
        </div>
      )}
      {result && (
        <div className="border-border space-y-4 border-t px-5 py-5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-medium">Результат комплектности</h3>
            {result.run_id && (
              <span className="text-copy-muted text-xs">
                запуск {result.run_id.slice(0, 8)}… · перечень v
                {result.package_version ?? "—"}
              </span>
            )}
          </div>
          {result.evaluation_absent_reason && !evaluation && (
            <p className="text-copy-muted text-sm">
              Оценка отсутствует: {result.evaluation_absent_reason}
            </p>
          )}
          {evaluation && (
            <>
              <div className="flex flex-wrap gap-2">
                {(["PD", "RD", "ID"] as const).map(
                  (stage) =>
                    evaluation.stages[stage] && (
                      <StageChip
                        key={stage}
                        stage={stage}
                        status={evaluation.stages[stage].status}
                      />
                    ),
                )}
                <span className="bg-accent/10 text-accent rounded-full px-3 py-1 text-xs font-medium">
                  {scenarioLabels[evaluation.scenario] ?? evaluation.scenario}
                </span>
              </div>
              <p className="text-copy-muted text-xs">
                Применимо {evaluation.counts.applicable} · закрыто{" "}
                {evaluation.counts.fulfilled} · отсутствует{" "}
                {evaluation.counts.missing} · требует уточнения{" "}
                {evaluation.counts.unverifiable} · не применимо{" "}
                {evaluation.counts.not_applicable}
              </p>
              <ul className="divide-border divide-y">
                {evaluation.requirements.map((requirement) => (
                  <li key={requirement.requirement_id} className="py-3">
                    <div className="flex flex-wrap items-start gap-3">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          requirement.outcome === "fulfilled"
                            ? "bg-accent/10 text-accent"
                            : requirement.outcome === "missing"
                              ? "bg-danger/10 text-danger"
                              : "bg-surface-high text-copy-muted"
                        }`}
                      >
                        {outcomeLabels[requirement.outcome] ??
                          requirement.outcome}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm break-words">
                          {requirement.title}
                        </p>
                        <p className="text-copy-muted mt-0.5 text-xs">
                          {requirement.code} ·{" "}
                          {stageLabels[requirement.stage] ?? requirement.stage}
                        </p>
                        {requirement.reasons.length > 0 && (
                          <p className="text-copy-muted mt-1 text-xs">
                            {requirement.reasons
                              .map(outcomeReasonLabel)
                              .join("; ")}
                          </p>
                        )}
                        {requirement.missing_parts.length > 0 && (
                          <p className="text-danger mt-1 text-xs">
                            Не хватает: {requirement.missing_parts.join("; ")}
                          </p>
                        )}
                        {requirement.matched.length > 0 && (
                          <p className="text-copy-muted mt-1 text-xs">
                            Документов: {requirement.matched.length}
                          </p>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
