import { Button } from "@heroui/react";
import { useMemo, useState } from "react";

import { useAdminDocumentStats } from "@/api/hooks/use-admin-documents";
import type { AdminDocumentStatsRange } from "@/api/types/admin-documents";
import { Area } from "@/components/charts/area";
import { AreaChart } from "@/components/charts/area-chart";
import { Grid } from "@/components/charts/grid";
import { ChartTooltip, type TooltipRow } from "@/components/charts/tooltip";
import { XAxis } from "@/components/charts/x-axis";
import { YAxis } from "@/components/charts/y-axis";
import { UploadIcon, type UploadIconName } from "@/components/UploadIcon";
import { cn } from "@/lib/utils";

const ranges: { value: AdminDocumentStatsRange; label: string }[] = [
  { value: "3m", label: "3 месяца" },
  { value: "30d", label: "30 дней" },
  { value: "7d", label: "7 дней" },
  { value: "1d", label: "1 день" },
];

const hourTickFmt = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const hourTitleFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const formatHourTick = (date: Date) => hourTickFmt.format(date);
const formatHourTitle = (date: Date) => hourTitleFmt.format(date);

type BadgeTone = "danger" | "neutral" | "success";

const badgeTones: Record<BadgeTone, string> = {
  success: "border-success/30 bg-success/10 text-success",
  danger: "border-danger/30 bg-danger/10 text-danger",
  neutral: "border-border bg-surface-high text-copy-muted",
};

interface StatCardProps {
  badge?: { text: string; tone: BadgeTone };
  caption: string;
  captionIcon?: UploadIconName;
  captionTone?: BadgeTone;
  detail: string;
  label: string;
  value?: number;
}

function StatCard({
  badge,
  caption,
  captionIcon,
  captionTone = "neutral",
  detail,
  label,
  value,
}: StatCardProps) {
  return (
    <div className="border-accent from-accent/10 dark:from-accent/15 to-card first:bg-accent first:**:text-accent-foreground min-w-0 rounded-[20px] border-b-2 p-5 shadow-[0_0_0_1px_var(--border)] not-first:bg-linear-to-t first:shadow-none">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-copy-muted text-sm font-medium">{label}</h3>
        {badge && (
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums",
              badgeTones[badge.tone],
            )}
          >
            {badge.text}
          </span>
        )}
      </div>
      {value === undefined ? (
        <span className="bg-surface-high mt-2 block h-9 w-20 animate-pulse rounded-lg" />
      ) : (
        <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">
          {value.toLocaleString("ru-RU")}
        </p>
      )}
      <p
        className={cn(
          "mt-3 flex items-center gap-1.5 text-sm font-medium",
          captionTone === "success" && "text-success",
          captionTone === "danger" && "text-danger",
          captionTone === "neutral" && "text-foreground",
        )}
      >
        {captionIcon && <UploadIcon className="size-4" name={captionIcon} />}
        {caption}
      </p>
      <p className="text-copy-muted mt-1 truncate text-xs">{detail}</p>
    </div>
  );
}

export function DocumentsAnalytics() {
  const [range, setRange] = useState<AdminDocumentStatsRange>("1d");
  const query = useAdminDocumentStats(range);
  const stats = query.isError ? undefined : query.data;
  const totals = stats?.totals;

  const chartData = useMemo(
    () =>
      (stats?.series ?? []).map((point: { date: string; uploads: number }) => ({
        date: point.date,
        uploads: point.uploads,
      })),
    [stats],
  );

  const share = (count: number | undefined) =>
    totals && count !== undefined && totals.files > 0
      ? Math.round((count / totals.files) * 100)
      : null;

  const delta = stats?.uploads.delta_percent ?? null;
  const deltaBadge: StatCardProps["badge"] =
    delta === null
      ? undefined
      : {
          text: `${delta > 0 ? "+" : ""}${delta.toLocaleString("ru-RU")}%`,
          tone: delta > 0 ? "success" : delta < 0 ? "danger" : "neutral",
        };

  const errorsCount = totals
    ? totals.failed + totals.integrity_errors
    : undefined;
  const errorsShare = share(errorsCount);

  const cards: StatCardProps[] = [
    {
      label: "Всего документов",
      value: totals?.files,
      badge: deltaBadge,
      captionIcon: delta !== null && delta < 0 ? "trend-down" : "trend-up",
      caption:
        delta !== null && delta > 0
          ? "Загрузки растут"
          : delta !== null && delta < 0
            ? "Загрузки снижаются"
            : "Динамика загрузок",
      captionTone:
        delta !== null && delta > 0
          ? "success"
          : delta !== null && delta < 0
            ? "danger"
            : "neutral",
      detail: stats ? `За период: ${stats.uploads.current}` : "",
    },
    {
      label: "Обработано",
      value: totals?.succeeded,
      badge:
        share(totals?.succeeded) !== null
          ? { text: `${share(totals?.succeeded)}%`, tone: "neutral" }
          : undefined,
      captionIcon: "check",
      caption: "Успешная обработка",
      detail: "от всех документов",
    },
    {
      label: "В обработке",
      value: totals?.in_progress,
      badge:
        share(totals?.in_progress) !== null
          ? { text: `${share(totals?.in_progress)}%`, tone: "neutral" }
          : undefined,
      captionIcon: "layers",
      caption: "Очередь парсинга",
      detail: "ожидают или обрабатываются",
    },
    {
      label: "Ошибки",
      value: errorsCount,
      badge:
        errorsShare !== null
          ? {
              text: `${errorsShare}%`,
              tone: errorsCount ? "danger" : "neutral",
            }
          : undefined,
      captionIcon: "warning",
      caption: "Требуют внимания",
      captionTone: errorsCount ? "danger" : "neutral",
      detail: totals
        ? `Парсинг: ${totals.failed} · целостность: ${totals.integrity_errors}`
        : "",
    },
  ];

  return (
    <section aria-label="Аналитика документов" className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <StatCard key={card.label} {...card} />
        ))}
      </div>

      <div className="border-border bg-card min-w-0 overflow-hidden rounded-[20px] border shadow-sm">
        <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Загрузки документов</h2>
            <p className="text-copy-muted text-sm">
              Новые документы по дням за выбранный период
            </p>
          </div>
          <div
            aria-label="Период аналитики"
            className="bg-surface-high flex rounded-xl p-1"
            role="group"
          >
            {ranges.map((option) => (
              <button
                aria-pressed={range === option.value}
                className={cn(
                  "text-copy-muted rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  range === option.value && "bg-card text-foreground shadow-sm",
                )}
                key={option.value}
                onClick={() => setRange(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {query.isError ? (
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
        ) : (
          <div className="px-3 pt-4 pb-3 sm:px-5">
            <AreaChart
              aspectRatio="auto"
              className="h-60 w-full sm:h-72"
              data={chartData}
              loadingLabel="Загружаем график…"
              status={
                query.isPending || query.isFetching || query.isLoading
                  ? "loading"
                  : "ready"
              }
              xTickFormatter={range === "1d" ? formatHourTick : undefined}
            >
              <Grid horizontal />
              <Area dataKey="uploads" />
              {!(query.isPending || query.isFetching || query.isLoading) && (
                <>
                  <XAxis numTicks={range === "1d" ? 7 : 5} />
                  <YAxis />
                </>
              )}
              <ChartTooltip
                formatTitle={range === "1d" ? formatHourTitle : undefined}
                rows={(point): TooltipRow[] => [
                  {
                    color: "var(--chart-line-primary)",
                    label: "Загрузок",
                    value: (point.uploads as number) ?? 0,
                  },
                ]}
                panelStyle={{
                  backgroundColor:
                    "color-mix(in srgb, var(--background) 25%, transparent)",
                }}
              />
            </AreaChart>
          </div>
        )}
      </div>
    </section>
  );
}
