import { Button, Popover, Tooltip, useMediaQuery } from "@heroui/react";

import { cn } from "@/lib/utils";
import { DashboardIcon } from "./DashboardIcon";

const availabilityBars = Array.from({ length: 48 }, (_, index) => index);

interface SystemStatusPopoverProps {
  compact?: boolean;
}

export function SystemStatusPopover({
  compact = false,
}: SystemStatusPopoverProps) {
  const isMobile = useMediaQuery("(max-width: 761px)");

  return (
    <Tooltip isDisabled={!compact}>
      <Popover>
        <Button
          aria-label="Статус системы"
          className="h-11 w-full flex-none justify-start gap-3 rounded-[14px] px-4"
          isIconOnly={compact}
          variant="ghost"
        >
          <DashboardIcon className="size-5 shrink-0" name="pulse" />
          <span
            className={cn(
              "text-foreground text-sm font-medium transition-all",
              compact && "opacity-0",
            )}
          >
            Статус системы
          </span>
        </Button>

        <Popover.Content
          className="w-[min(460px,calc(100vw-24px))] overflow-hidden rounded-[24px] border p-0 shadow-2xl"
          offset={12}
          placement={!isMobile ? "right" : undefined}
        >
          <Popover.Dialog className="p-0 outline-none">
            <div className="flex items-center justify-between gap-4 border-b px-5 py-[18px]">
              <Popover.Heading className="flex items-center gap-3 text-lg font-semibold tracking-[-0.02em]">
                <span className="bg-success text-success-foreground grid size-7 shrink-0 place-items-center rounded-full">
                  <span aria-hidden="true" className="text-sm font-bold">
                    ✓
                  </span>
                </span>
                Система работает штатно
              </Popover.Heading>
              <span className="bg-success/15 text-success flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-semibold">
                <span
                  aria-hidden="true"
                  className="bg-success ring-success/15 size-2 rounded-full ring-4"
                />
                Онлайн
              </span>
            </div>

            <div className="border-b px-5 py-5">
              <p className="text-base font-medium">
                Сервис доступен круглосуточно, 24/7
              </p>
              <p className="mt-1 text-sm leading-relaxed">
                Сейчас нет проблем, влияющих на работу системы.
              </p>
            </div>

            <div className="px-5 pt-5 pb-4">
              <div
                aria-label="История доступности за последние 90 дней"
                className="flex h-11 items-end gap-1"
                role="img"
              >
                {availabilityBars.map((bar) => (
                  <span
                    className={`h-9 min-w-0 flex-1 rounded-full ${bar === 31 ? "bg-destructive" : "bg-success"}`}
                    key={bar}
                  />
                ))}
              </div>
              <div className="mt-1.5 flex items-center justify-between text-xs">
                <span>Последние 90 дней</span>
                <span>Сегодня</span>
              </div>

              <Button
                className="mt-5 h-12 w-full rounded-[14px]"
                variant="ghost"
              >
                Открыть страницу статуса
                <span aria-hidden="true">↗</span>
              </Button>
            </div>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
      <Tooltip.Content offset={5} placement="right">
        Статус системы
      </Tooltip.Content>
    </Tooltip>
  );
}
