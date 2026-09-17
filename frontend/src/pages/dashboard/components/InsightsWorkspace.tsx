import { Button } from "@heroui/react";

import { cn } from "@/lib/utils";
import type { DashboardIconName } from "./DashboardIcon";
import { DashboardIcon } from "./DashboardIcon";

export interface InsightsWorkspaceProps {
  className?: string;
}

interface ToolbarIconButtonProps {
  label: string;
  name: DashboardIconName;
}

const pipelineStages = [
  {
    count: "2,104",
    label: "Incoming",
    shape:
      "h-[92%] bg-accent/10 [clip-path:polygon(0_0,100%_10%,100%_90%,0_100%)]",
    rate: null,
  },
  {
    count: "1,248",
    label: "Screen",
    shape:
      "h-[92%] bg-accent/20 [clip-path:polygon(0_10%,100%_23%,100%_77%,0_90%)]",
    rate: "59.3%",
  },
  {
    count: "621",
    label: "On-site",
    shape:
      "h-[92%] bg-accent/40 [clip-path:polygon(0_23%,100%_35%,100%_65%,0_77%)]",
    rate: "49.8%",
  },
  {
    count: "203",
    label: "Case",
    shape:
      "h-[92%] bg-accent/60 [clip-path:polygon(0_35%,100%_39%,100%_61%,0_65%)]",
    rate: "32.7%",
  },
  {
    count: "52",
    label: "Offer",
    shape:
      "h-[92%] bg-accent/80 [clip-path:polygon(0_39%,100%_40%,100%_60%,0_61%)]",
    rate: "25.6%",
  },
  {
    count: "52",
    label: "Hired",
    shape:
      "h-[92%] bg-accent [clip-path:polygon(0_40%,100%_40%,100%_60%,0_60%)]",
    rate: "100%",
  },
] as const;

const feedback = [
  {
    initials: "AC",
    name: "Angelina Conn",
    note: "Strong problem solver, clear communicator",
    stage: "Awaiting case",
    team: "Engineering",
    reference: "R-004010",
  },
  {
    initials: "RB",
    name: "Robert Bashirian",
    note: "Analytical thinker, needs stronger storytelling",
    stage: "Awaiting case",
    team: "Growth",
    reference: "R-002300",
  },
  {
    initials: "WP",
    name: "Will Pollich",
    note: "Systems thinker, highly collaborative",
    stage: "Awaiting case",
    team: "Engineering",
    reference: "R-004010",
  },
  {
    initials: "JK",
    name: "Jenny Kertzmann",
    note: "Structured, senior-level presence",
    stage: "Awaiting on-site",
    team: "Sales",
    reference: "R-002300",
  },
] as const;

function ToolbarIconButton({ label, name }: ToolbarIconButtonProps) {
  return (
    <Button
      aria-label={label}
      className="text-copy-muted hover:bg-surface-raised size-9 min-w-9 rounded-[11px]"
      isIconOnly
      size="sm"
      variant="ghost"
    >
      <DashboardIcon className="size-[18px]" name={name} />
    </Button>
  );
}

function FilterButton({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="text-copy-muted mb-1.5 block px-1 text-[10px] font-medium">
        {label}
      </span>
      <Button
        className="border-border bg-surface text-foreground h-11 w-full min-w-0 justify-between gap-3 rounded-[12px] border px-3.5 text-[13px] font-semibold shadow-none"
        variant="ghost"
      >
        <span className="truncate">{value}</span>
        <DashboardIcon
          className="text-copy-muted size-3.5 shrink-0"
          name="chevron-down"
        />
      </Button>
    </div>
  );
}

function CardHeading({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div>
      <h2 className="text-card-foreground text-[15px] font-semibold tracking-[-0.015em]">
        {title}
      </h2>
      <p className="text-copy-muted mt-1 text-[13px] leading-none">
        {description}
      </p>
    </div>
  );
}

function SurveyCountCard() {
  return (
    <article className="bg-accent text-accent-foreground flex min-h-[202px] flex-col overflow-hidden rounded-[25px] px-[clamp(22px,2.3vw,34px)] py-7">
      <div>
        <h2 className="text-[15px] font-semibold">Survey Count</h2>
        <p className="text-accent-foreground/65 mt-1 max-w-60 text-[13px] leading-[1.45]">
          Employees who have taken
          <br className="max-[540px]:hidden" /> submitted the survey
        </p>
      </div>
      <div className="mt-auto flex items-end justify-between gap-4">
        <strong className="text-[clamp(38px,3.5vw,52px)] leading-none font-normal tracking-[-0.045em]">
          2,104
        </strong>
        <span className="bg-accent-foreground/12 mb-0.5 flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-[11px] font-medium max-[520px]:hidden">
          <span
            aria-hidden="true"
            className="bg-success ring-success/20 size-2 rounded-full ring-4"
          />
          +281 from previous period
        </span>
      </div>
    </article>
  );
}

function GenderBalanceCard() {
  return (
    <article className="border-border bg-card min-h-[268px] overflow-hidden rounded-[25px] border p-[clamp(22px,2.2vw,32px)]">
      <CardHeading description="Pipeline composition" title="Gender Balance" />

      <div className="relative mt-8 h-[151px]">
        <div
          aria-hidden="true"
          className="absolute inset-0 flex flex-col justify-between"
        >
          {["100%", "75%", "50%", "25%"].map((label) => (
            <div
              className="border-border/70 relative border-t border-dashed"
              key={label}
            >
              <span className="text-copy-muted bg-card absolute -top-2.5 right-0 pl-2 text-[9px]">
                {label}
              </span>
            </div>
          ))}
        </div>

        <div className="absolute inset-x-0 bottom-0 grid h-[116px] grid-cols-[1fr_1fr_0.72fr] items-end gap-1">
          <div className="flex h-full min-w-0 flex-col justify-end">
            <strong className="mb-2 text-[clamp(23px,2.2vw,35px)] leading-none font-normal tracking-[-0.04em]">
              46%
            </strong>
            <div className="bg-accent text-accent-foreground h-[46%] min-h-[58px] rounded-t-md px-3 pt-4">
              <span className="block truncate text-[12px] opacity-65">
                Female
              </span>
              <span className="text-[13px] font-semibold">968</span>
            </div>
          </div>
          <div className="flex h-full min-w-0 flex-col justify-end">
            <strong className="mb-2 text-[clamp(23px,2.2vw,35px)] leading-none font-normal tracking-[-0.04em]">
              48%
            </strong>
            <div className="bg-accent text-accent-foreground h-[48%] min-h-[60px] rounded-t-md px-3 pt-4">
              <span className="block truncate text-[12px] opacity-65">
                Male
              </span>
              <span className="text-[13px] font-semibold">1,010</span>
            </div>
          </div>
          <div className="flex h-full min-w-0 flex-col justify-end">
            <strong className="mb-2 text-[clamp(23px,2.2vw,35px)] leading-none font-normal tracking-[-0.04em]">
              6%
            </strong>
            <div className="bg-accent text-accent-foreground h-[15%] min-h-[28px] rounded-t-md px-2 pt-1.5">
              <span className="block truncate text-[10px] opacity-65">
                Non-binary
              </span>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function PipelineStagesCard() {
  return (
    <article className="border-border bg-card min-h-[392px] overflow-hidden rounded-[25px] border p-[clamp(22px,2.2vw,32px)]">
      <CardHeading
        description="Applied/Sourced through hire"
        title="Pipeline Stages"
      />

      <div className="-mx-2 mt-6 overflow-x-auto px-2 pb-1">
        <div className="min-w-[590px]">
          <div className="relative grid h-[222px] grid-cols-6 items-center overflow-hidden">
            {pipelineStages.map((stage) => (
              <div
                className="border-border/80 relative flex h-full items-center border-r border-dashed last:border-r-0"
                key={stage.label}
              >
                <div className={cn("relative w-[calc(100%+1px)]", stage.shape)}>
                  {stage.rate ? (
                    <span className="bg-surface text-foreground shadow-overlay absolute top-1/2 left-1/2 z-1 -translate-x-1/2 -translate-y-1/2 rounded-full px-2.5 py-1 text-[9px] font-semibold whitespace-nowrap">
                      {stage.rate} →
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-6 pt-3">
            {pipelineStages.map((stage) => (
              <div className="min-w-0 px-1" key={stage.label}>
                <span className="text-copy-muted block truncate text-[12px]">
                  {stage.label}
                </span>
                <strong className="mt-1 block text-[13px] font-semibold">
                  {stage.count}
                </strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

function OfferAcceptanceCard() {
  return (
    <article className="border-border bg-card flex min-h-[202px] flex-col rounded-[25px] border p-[clamp(22px,2.2vw,32px)]">
      <CardHeading
        description="% of offers accepted"
        title="Offer Acceptance Rate"
      />
      <div className="mt-auto flex items-end justify-between gap-4 pt-8">
        <strong className="text-[clamp(42px,4vw,58px)] leading-none font-normal tracking-[-0.05em]">
          100%
        </strong>
        <span className="bg-surface-high text-copy-muted mb-1 flex items-center gap-2 rounded-full px-3 py-2 text-[11px] max-[480px]:hidden">
          <span
            aria-hidden="true"
            className="bg-success ring-success/20 size-2 rounded-full ring-4"
          />
          +6% from previous period
        </span>
      </div>
    </article>
  );
}

function SelectedFeedbackCard() {
  return (
    <article className="border-border bg-card flex min-h-[594px] flex-1 flex-col overflow-hidden rounded-[25px] border p-[clamp(22px,2.2vw,32px)] max-[1120px]:min-h-0">
      <div className="border-border flex items-start justify-between gap-5 border-b pb-5 max-[520px]:block">
        <CardHeading
          description="Candidates in active process"
          title="Selected Feedback"
        />
        <div className="flex shrink-0 gap-2 max-[520px]:mt-4">
          <FilterButton label="Этап" value="On-site" />
          <FilterButton label="Сортировка" value="Recent" />
        </div>
      </div>

      <div className="divide-border flex flex-1 flex-col divide-y">
        {feedback.map((item) => (
          <div className="flex gap-3 py-5" key={item.name}>
            <div className="bg-surface-raised text-copy-muted grid size-9 shrink-0 place-items-center rounded-[11px] text-[10px] font-semibold">
              {item.initials}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-[13px] font-semibold">
                {item.name}
              </h3>
              <p className="text-copy-muted mt-1 truncate text-[12px]">
                {item.note}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="border-border rounded-full border px-2.5 py-1 text-[9px]">
                  {item.stage}
                </span>
                <span className="border-border text-copy-muted rounded-full border px-2.5 py-1 text-[9px]">
                  {item.team}
                </span>
                <span className="border-border text-copy-muted rounded-full border px-2.5 py-1 font-mono text-[9px]">
                  {item.reference}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

function WorkspaceToolbar() {
  return (
    <header className="flex h-[var(--topbar-height)] shrink-0 items-center gap-4 px-4 py-10 max-[680px]:gap-2 max-[680px]:px-2.5">
      <div className="bg-surface-high flex shrink-0 items-center rounded-[14px] p-1">
        <ToolbarIconButton label="Закрыть рабочую область" name="close" />
        <span className="bg-border mx-0.5 h-5 w-px max-[520px]:hidden" />
        <span className="max-[520px]:hidden">
          <ToolbarIconButton label="Развернуть" name="expand" />
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold tracking-[-0.01em]">
          Recruiting Insights Dashboard
        </p>
        <p className="text-copy-muted mt-0.5 truncate text-[11px]">
          Обновляется в реальном времени
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="bg-surface-high flex items-center rounded-[14px] p-1 max-[930px]:hidden">
          <ToolbarIconButton label="История" name="history" />
          <span className="bg-border h-5 w-px" />
          <ToolbarIconButton label="Копировать" name="copy" />
          <span className="bg-border h-5 w-px" />
          <ToolbarIconButton label="Открыть папку" name="folder" />
        </div>

        <Button
          className="bg-surface-high text-foreground h-11 rounded-full px-4 text-[12px] font-semibold max-[760px]:hidden"
          variant="ghost"
        >
          <DashboardIcon className="size-[17px]" name="globe" />
          Опубликовать
        </Button>

        <Button
          aria-label="Поделиться приложением"
          className="bg-foreground text-background hover:bg-foreground/85 h-11 rounded-full px-4 text-[12px] font-semibold max-[520px]:size-11 max-[520px]:min-w-11 max-[520px]:px-0"
          variant="ghost"
        >
          <DashboardIcon className="size-[17px]" name="upload" />
          <span className="max-[520px]:hidden">Поделиться</span>
        </Button>
      </div>
    </header>
  );
}

export function InsightsWorkspace({ className }: InsightsWorkspaceProps) {
  return (
    <section
      className={cn(
        "bg-background flex h-full min-h-0 min-w-0 flex-col overflow-hidden",
        className,
      )}
      aria-label="Аналитическая рабочая область"
    >
      <WorkspaceToolbar />

      <div className="max-h-full flex-1 overflow-hidden p-[18px] pt-0 max-[680px]:p-0">
        <div className="bg-surface h-full overflow-hidden rounded-[28px] border max-[680px]:rounded-t-3xl">
          <div className="h-full overflow-auto p-[clamp(22px,3vw,48px)] pt-8">
            <div className="mb-[clamp(30px,4vw,54px)] flex items-end justify-between gap-8 max-[920px]:block">
              <h1 className="text-[clamp(26px,2.4vw,38px)] leading-none font-semibold tracking-[-0.045em]">
                Recruiting Insights Dashboard
              </h1>

              <div className="grid w-full max-w-[620px] grid-cols-[1.15fr_0.85fr_1fr_0.78fr_auto] items-end gap-2 max-[920px]:mt-7 max-[920px]:max-w-none max-[620px]:grid-cols-2">
                <FilterButton label="Отдел" value="Все отделы" />
                <FilterButton label="Роль" value="Все роли" />
                <FilterButton label="Начало периода" value="Янв 2025" />
                <FilterButton label="Конец периода" value="Сегодня" />
                <Button
                  aria-label="Обновить данные"
                  className="text-foreground h-11 min-w-fit rounded-[12px] px-3 text-[12px] font-semibold max-[620px]:col-span-2 max-[620px]:w-full"
                  variant="ghost"
                >
                  <DashboardIcon className="size-4" name="refresh" />
                  Обновить
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)] items-start gap-5 max-[1120px]:grid-cols-1">
              <div className="flex min-w-0 flex-col gap-5">
                <SurveyCountCard />
                <PipelineStagesCard />
                <OfferAcceptanceCard />
              </div>
              <div className="flex min-w-0 flex-col gap-5">
                <GenderBalanceCard />
                <SelectedFeedbackCard />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
