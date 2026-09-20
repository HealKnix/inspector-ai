import { Button, Spinner } from "@heroui/react";
import { useMemo } from "react";

import {
  completenessErrorMessage,
  useExpectedPackage,
  useGeneratePackage,
} from "@/api/hooks/use-completeness";
import type { ExpectedPackage } from "@/api/types/completeness";
import { DocumentStage, type UploadRow } from "@/pages/document-upload/types";

import { UploadIcon } from "@/components/UploadIcon";

interface CompletenessPanelProps {
  objectId: string;
  rows: readonly UploadRow[];
}

const stages: Array<{ stage: DocumentStage; label: string }> = [
  { stage: DocumentStage.PD, label: "Проектная документация" },
  { stage: DocumentStage.RD, label: "Рабочая документация" },
  { stage: DocumentStage.ID, label: "Исполнительная документация" },
];

function expectedCounts(pkg: ExpectedPackage) {
  const counts: Record<DocumentStage, number> = {
    [DocumentStage.PD]: 0,
    [DocumentStage.RD]: 0,
    [DocumentStage.ID]: 0,
  };
  for (const requirement of pkg.requirements) {
    if (requirement.excluded) continue;
    const multiplier =
      requirement.quantity.per === "list_item"
        ? Math.max(1, pkg.list_items.length)
        : 1;
    counts[requirement.stage] += requirement.quantity.min * multiplier;
  }
  return counts;
}

function uploadedCounts(rows: readonly UploadRow[]) {
  const counts: Record<DocumentStage, number> = {
    [DocumentStage.PD]: 0,
    [DocumentStage.RD]: 0,
    [DocumentStage.ID]: 0,
  };
  for (const row of rows) {
    if (row.stage !== null) counts[row.stage] += 1;
  }
  return counts;
}

export function CompletenessPanel({ objectId, rows }: CompletenessPanelProps) {
  const packageQuery = useExpectedPackage(objectId);
  const generate = useGeneratePackage(objectId);

  const expected = useMemo(
    () =>
      packageQuery.data?.package
        ? expectedCounts(packageQuery.data.package)
        : null,
    [packageQuery.data],
  );
  const uploaded = useMemo(() => uploadedCounts(rows), [rows]);
  const pkg = packageQuery.data?.package ?? null;
  const totalExpected = expected
    ? expected[DocumentStage.PD] +
      expected[DocumentStage.RD] +
      expected[DocumentStage.ID]
    : 0;
  const totalUploaded =
    uploaded[DocumentStage.PD] +
    uploaded[DocumentStage.RD] +
    uploaded[DocumentStage.ID];

  return (
    <section className="border-border bg-card rounded-[20px] border p-5 shadow-sm sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Комплектность</h2>
        {pkg && (
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              pkg.status === "confirmed"
                ? "bg-success/15 text-success"
                : "bg-warning/15 text-warning"
            }`}
          >
            {pkg.status === "confirmed"
              ? "Состав подтверждён"
              : "Состав предложен"}
          </span>
        )}
      </div>

      {packageQuery.isPending && (
        <p
          className="text-copy-muted mt-4 flex items-center gap-2 text-sm"
          role="status"
        >
          <Spinner size="sm" /> Загружаем эталонный состав…
        </p>
      )}

      {packageQuery.isError && (
        <div className="mt-4">
          <p className="text-danger text-sm">
            {completenessErrorMessage(packageQuery.error)}
          </p>
          <Button
            className="mt-3 rounded-xl"
            size="sm"
            variant="outline"
            onPress={() => {
              void packageQuery.refetch();
            }}
          >
            Повторить
          </Button>
        </div>
      )}

      {packageQuery.data && !pkg && (
        <div className="mt-4">
          <p className="text-copy-muted text-sm leading-6">
            Эталонный состав не задан. Он формируется при создании объекта —
            здесь можно сформировать его по нормативному перечню.
          </p>
          <Button
            className="mt-3 rounded-xl"
            isPending={generate.isPending}
            size="sm"
            variant="outline"
            onPress={() => generate.mutate({ attributes: {} })}
          >
            Сформировать состав
          </Button>
        </div>
      )}

      {pkg && expected && (
        <>
          <dl className="divide-border border-border mt-4 divide-y overflow-hidden rounded-[14px] border">
            {stages.map(({ stage, label }) => {
              const expectedCount = expected[stage];
              const uploadedCount = uploaded[stage];
              const complete =
                expectedCount > 0 && uploadedCount >= expectedCount;
              return (
                <div
                  className="grid grid-cols-[42px_1fr_auto] items-center gap-3 px-3 py-3"
                  key={stage}
                >
                  <dt className="font-semibold">
                    {stage === DocumentStage.ID ? "ИД" : stage}
                  </dt>
                  <dd className="text-copy-muted min-w-0 truncate text-xs">
                    {label}
                  </dd>
                  <dd className="flex items-center gap-2 text-xs font-medium whitespace-nowrap">
                    <span
                      className={`grid size-5 place-items-center rounded-full ${
                        complete
                          ? "bg-success text-success-foreground"
                          : "bg-surface-raised text-copy-muted"
                      }`}
                    >
                      {complete ? (
                        <UploadIcon className="size-3" name="check" />
                      ) : (
                        "—"
                      )}
                    </span>
                    {uploadedCount} из {expectedCount}
                  </dd>
                </div>
              );
            })}
          </dl>
          <p className="bg-surface-high text-copy-muted mt-4 rounded-[14px] px-4 py-3 text-sm leading-5">
            Загружено {totalUploaded} из {totalExpected} документов эталонного
            состава.
          </p>
        </>
      )}
    </section>
  );
}
