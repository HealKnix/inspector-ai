import { Button } from "@heroui/react";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { UploadIcon } from "@/components/UploadIcon";
import { ConstrainedLayout, PageHeader } from "@/layouts/ConstrainedLayout";
import routeNames from "@/routes/routeNames";
import { useProtocolStore } from "@/store/protocols";

import { ProtocolFindings } from "./components/ProtocolFindings";
import { formatProtocolDate, getProtocolSummary } from "./lib/protocols";

interface SummaryCardProps {
  label: string;
  value: number;
  tone: "accent" | "danger" | "success" | "warning";
}

const summaryToneClasses: Record<SummaryCardProps["tone"], string> = {
  accent: "bg-accent/10 text-accent",
  danger: "bg-danger/10 text-danger",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
};

function SummaryCard({ label, tone, value }: SummaryCardProps) {
  return (
    <div className="border-border bg-surface-low rounded-2xl border p-4">
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`grid size-8 place-items-center rounded-xl text-sm font-semibold ${summaryToneClasses[tone]}`}
        >
          {tone === "success" ? "✓" : "!"}
        </span>
        <span className="text-copy-muted text-sm">{label}</span>
      </div>
      <strong className="mt-3 block text-2xl font-semibold tabular-nums">
        {value}
      </strong>
    </div>
  );
}

function ProtocolNotFound() {
  const navigate = useNavigate();

  return (
    <ConstrainedLayout>
      <section
        className="border-border bg-card w-full rounded-[20px] border p-6 text-center shadow-sm"
        role="alert"
      >
        <span className="bg-warning/10 text-warning mx-auto grid size-12 place-items-center rounded-2xl">
          <UploadIcon className="size-6" name="warning" />
        </span>
        <h1 className="mt-4 text-2xl font-semibold">Протокол не найден</h1>
        <p className="text-copy-muted mt-2 text-sm leading-6">
          Он отсутствует в текущем демонстрационном наборе или был создан в
          другой сессии приложения.
        </p>
        <Button
          className="mt-5 rounded-xl"
          onPress={() => {
            void navigate(routeNames.PROTOCOLS, { replace: true });
          }}
          variant="outline"
        >
          К списку протоколов
        </Button>
      </section>
    </ConstrainedLayout>
  );
}

export function ProtocolDetailsPage() {
  const { protocolId = "" } = useParams();
  const protocol = useProtocolStore((state) =>
    state.protocols.find((candidate) => candidate.id === protocolId),
  );
  const [actionMessage, setActionMessage] = useState("");
  const summary = useMemo(
    () => getProtocolSummary(protocol?.violations ?? []),
    [protocol?.violations],
  );

  if (!protocol) return <ProtocolNotFound />;

  return (
    <ConstrainedLayout>
      <PageHeader
        backHref={routeNames.PROTOCOLS}
        backLabel="Все протоколы"
        badge="Сформирован"
        badgeIcon="check"
        description="Сводный демонстрационный протокол по результатам проверки комплекта документов."
        notice={protocol.fixtureNotice}
        noticeLabel="ДЕМО"
        title="Протокол"
      />

      <section
        aria-label="Сведения о протоколе"
        className="border-border bg-card mt-6 grid overflow-hidden rounded-[20px] border shadow-sm sm:grid-cols-2"
      >
        <div className="border-border flex min-w-0 items-center gap-4 border-b p-5 sm:border-r sm:border-b-0 sm:p-6">
          <span className="bg-accent/10 text-accent grid size-12 shrink-0 place-items-center rounded-2xl">
            <UploadIcon className="size-6" name="folder" />
          </span>
          <div className="min-w-0">
            <p className="text-copy-muted text-sm">Объект</p>
            <p className="mt-1 font-semibold break-words">
              {protocol.objectName}
            </p>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-4 p-5 sm:p-6">
          <span className="bg-accent/10 text-accent flex size-12 flex-none items-center justify-center rounded-2xl">
            <span aria-hidden="true" className="text-lg font-medium">
              {protocol.checkedAt.slice(-2)}
            </span>
          </span>
          <div>
            <p className="text-copy-muted text-sm">Дата проверки</p>
            <time
              className="mt-1 block font-semibold tabular-nums"
              dateTime={protocol.checkedAt}
            >
              {formatProtocolDate(protocol.checkedAt)}
            </time>
          </div>
        </div>
      </section>

      <div className="mt-4 grid items-start gap-4 min-[1200px]:grid-cols-12">
        <div className="min-w-0 min-[1200px]:col-span-8">
          <ProtocolFindings violations={protocol.violations} />
        </div>

        <aside className="grid min-w-0 gap-4 min-[720px]:grid-cols-2 min-[1200px]:col-span-4 min-[1200px]:grid-cols-1">
          <section
            aria-labelledby="protocol-summary-title"
            className="border-border bg-card rounded-[20px] border p-5 shadow-sm"
          >
            <h2 className="text-lg font-semibold" id="protocol-summary-title">
              Итоговая сводка
            </h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <SummaryCard
                label="Всего"
                tone="accent"
                value={summary.totalCount}
              />
              <SummaryCard
                label="Критические"
                tone="danger"
                value={summary.criticalCount}
              />
              <SummaryCard
                label="Существенные"
                tone="warning"
                value={summary.significantCount}
              />
              <SummaryCard
                label="Подтверждено"
                tone="success"
                value={summary.confirmedCount}
              />
            </div>
          </section>

          <section
            aria-labelledby="protocol-transfer-title"
            className="border-border bg-card rounded-[20px] border p-5 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <span className="bg-accent/10 text-accent grid size-10 shrink-0 place-items-center rounded-xl">
                <UploadIcon className="size-5" name="upload" />
              </span>
              <h2
                className="text-lg font-semibold"
                id="protocol-transfer-title"
              >
                Передача в ИАИС РиН
              </h2>
            </div>
            <p className="text-copy-muted mt-3 text-sm leading-6">
              Интеграция и выгрузка файлов не подключены к демонстрационному
              интерфейсу.
            </p>
            <Button
              className="mt-5 w-full rounded-xl"
              onPress={() => {
                setActionMessage(
                  "Демо-режим: данные не передавались в ИАИС РиН.",
                );
              }}
            >
              <UploadIcon className="size-4.5" name="share" />
              Передать в РиН
            </Button>
            <Button
              className="mt-3 w-full rounded-xl"
              onPress={() => {
                setActionMessage(
                  "Демо-режим: PDF-файл не формировался и не скачивался.",
                );
              }}
              variant="outline"
            >
              <UploadIcon className="size-4.5" name="download" />
              Экспорт PDF
            </Button>
            <p
              aria-live="polite"
              className="text-copy-muted mt-3 min-h-10 text-xs leading-5"
              role="status"
            >
              {actionMessage ||
                "Действия показывают только предполагаемую структуру будущей интеграции."}
            </p>
          </section>
        </aside>
      </div>

      <div
        className="bg-accent/10 text-accent mt-4 flex items-start gap-3 rounded-2xl px-4 py-3 text-xs leading-5"
        role="note"
      >
        <UploadIcon
          className="text-accent mt-0.5 size-4 shrink-0"
          name="info"
        />
        <p>
          Демонстрационный протокол сформирован из синтетического снимка
          обработанных нарушений и не является юридически значимым документом.
        </p>
      </div>
    </ConstrainedLayout>
  );
}
