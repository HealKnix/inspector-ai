import { Button } from "@heroui/react";

import { BrandMark } from "@/components/BrandMark";

import { DashboardIcon } from "./DashboardIcon";

export interface ChatPanelProps {
  className?: string;
}

function ArtifactPreview() {
  return (
    <div
      aria-hidden="true"
      className="border-line bg-surface relative h-[68px] w-[112px] shrink-0 overflow-hidden rounded-[8px] border p-2 shadow-sm"
    >
      <div className="bg-surface-raised mb-2 h-1 w-8 rounded-full" />
      <div className="grid h-[43px] grid-cols-[1.1fr_0.9fr] gap-1.5">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="bg-accent h-[14px] rounded-[3px]" />
          <div className="border-line flex flex-1 items-end gap-px rounded-[3px] border px-1 pt-1">
            <span className="bg-accent/15 h-full flex-1" />
            <span className="bg-accent/30 h-3/4 flex-1" />
            <span className="bg-accent/50 h-1/2 flex-1" />
            <span className="bg-accent h-1/3 flex-1" />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="border-line flex flex-1 items-end gap-px rounded-[3px] border px-1 pt-1">
            <span className="bg-accent h-1/2 flex-1 rounded-t-[1px]" />
            <span className="bg-accent h-3/4 flex-1 rounded-t-[1px]" />
            <span className="bg-accent h-1/3 flex-1 rounded-t-[1px]" />
          </div>
          <div className="bg-surface-high h-[13px] rounded-[3px]" />
        </div>
      </div>
    </div>
  );
}

function ChatHeader() {
  return (
    <header className="border-line flex h-[72px] shrink-0 items-center justify-between gap-3 border-b px-5 max-[420px]:px-4">
      <Button
        aria-label="Открыть меню агента"
        className="min-w-0 gap-2 px-1 text-[14px] font-semibold"
        size="sm"
        variant="ghost"
      >
        <BrandMark className="text-accent size-7 shrink-0" />
        <span className="truncate">Инспектор ИИ</span>
        <DashboardIcon
          className="text-copy-muted size-4 shrink-0"
          name="chevron-down"
        />
      </Button>

      <Button
        aria-label="Поделиться чатом"
        className="shrink-0 rounded-full px-3 max-[420px]:px-2"
        size="sm"
        variant="secondary"
      >
        <DashboardIcon className="size-4" name="share" />
        <span className="max-[420px]:sr-only">Поделиться</span>
      </Button>
    </header>
  );
}

function Conversation() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-[clamp(18px,3vw,42px)] pt-6 pb-8">
      <div className="ml-auto flex max-w-[390px] items-start justify-end gap-2.5">
        <p className="bg-surface-high rounded-[22px] rounded-tr-[7px] px-4 py-3 text-[14px] leading-[1.45]">
          Создай дашборд с этапами найма, метриками разнообразия и отзывами с
          интервью из Workday Recruiting.
        </p>
        <span
          aria-hidden="true"
          className="bg-accent text-accent-foreground grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold"
        >
          А
        </span>
      </div>

      <div className="max-w-[430px]">
        <div className="text-copy-muted mb-2.5 flex items-center gap-1 text-xs">
          <span>Просмотр в холсте</span>
          <DashboardIcon className="size-3.5" name="chevron-right" />
        </div>
        <p className="text-[15px] leading-[1.7]">
          Готово! Вот дашборд с этапами найма, ключевыми метриками и отзывами с
          интервью — можно переходить к просмотру.
        </p>

        <article className="bg-surface-high mt-6 flex items-center gap-4 rounded-[18px] p-3.5">
          <ArtifactPreview />
          <div className="min-w-0">
            <h3 className="truncate text-[13px] font-semibold">
              Recruiting Insights Dashboard
            </h3>
            <p className="text-copy-muted mt-1 text-xs">Только что</p>
          </div>
        </article>

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <Button
            aria-label="Источник Workday"
            className="rounded-full px-3 text-xs"
            size="sm"
            variant="secondary"
          >
            <span
              aria-hidden="true"
              className="bg-surface text-accent grid size-5 place-items-center rounded-full text-[10px] font-bold"
            >
              W
            </span>
            Workday
          </Button>
          <Button
            aria-label="Копировать ответ"
            className="text-copy-muted"
            isIconOnly
            size="sm"
            variant="ghost"
          >
            <DashboardIcon className="size-[18px]" name="copy" />
          </Button>
          <Button
            aria-label="Ответ полезен"
            className="text-copy-muted"
            isIconOnly
            size="sm"
            variant="ghost"
          >
            <DashboardIcon className="size-[18px]" name="thumbs-up" />
          </Button>
          <Button
            aria-label="Ответ не полезен"
            className="text-copy-muted"
            isIconOnly
            size="sm"
            variant="ghost"
          >
            <DashboardIcon className="size-[18px]" name="thumbs-down" />
          </Button>
          <Button
            aria-label="Озвучить ответ"
            className="text-copy-muted"
            isIconOnly
            size="sm"
            variant="ghost"
          >
            <DashboardIcon className="size-[18px]" name="volume" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function ChatComposer() {
  return (
    <div className="shrink-0 px-5 pt-2 pb-3 max-[420px]:px-3">
      <div className="border-line bg-surface-high flex h-[54px] items-center gap-2 rounded-full border pr-2 pl-4">
        <DashboardIcon
          className="text-foreground size-[18px] shrink-0"
          name="lightning"
        />
        <input
          aria-label="Сообщение агенту"
          className="placeholder:text-copy-muted min-w-0 flex-1 bg-transparent text-[13px] outline-none"
          placeholder="Что вы хотите сделать?"
          type="text"
        />
        <Button
          aria-label="Отправить сообщение"
          className="bg-surface-raised text-copy-muted size-10 min-w-10 shrink-0 rounded-full"
          isIconOnly
          size="sm"
          variant="ghost"
        >
          <DashboardIcon className="size-[18px]" name="arrow-up" />
        </Button>
      </div>

      <div className="mt-2 flex items-center justify-between gap-1">
        <div className="flex min-w-0 items-center gap-0.5">
          <Button
            className="min-w-0 gap-1 px-2 text-xs font-semibold"
            size="sm"
            variant="ghost"
          >
            <DashboardIcon className="text-copy-muted size-4" name="sparkles" />
            Создать
          </Button>
          <Button
            className="min-w-0 gap-1 px-2 text-xs"
            size="sm"
            variant="ghost"
          >
            <DashboardIcon className="text-copy-muted size-4" name="sources" />
            Источники
          </Button>
        </div>
        <Button
          className="min-w-0 shrink-0 gap-1 px-2 text-xs"
          size="sm"
          variant="ghost"
        >
          <DashboardIcon className="text-copy-muted size-4" name="auto" />
          Авто
        </Button>
      </div>
    </div>
  );
}

export function ChatPanel({ className }: ChatPanelProps) {
  return (
    <section
      aria-label="Чат с агентом"
      className={`border-line bg-surface flex h-full min-h-0 min-w-0 flex-col border-r ${className ?? ""}`}
    >
      <ChatHeader />
      <Conversation />
      <ChatComposer />
    </section>
  );
}
