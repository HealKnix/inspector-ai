import { type ReactNode } from "react";
import { Link } from "react-router-dom";

import { UploadIcon, type UploadIconName } from "@/components/UploadIcon";
import { cn } from "@/lib/utils";
import { Breadcrumbs } from "@heroui/react";

export function ConstrainedLayout({ children }: { children: ReactNode }) {
  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto min-h-full space-y-6 overflow-hidden px-4 pt-5 pb-10 min-[1400px]:px-8 sm:px-16 sm:pt-7">
        {children}
      </div>
    </div>
  );
}

interface PageHeaderProps {
  actions?: ReactNode;
  backHref?: string;
  backLabel?: string;
  badge?: string;
  badgeIcon?: UploadIconName;
  breadcrumbs?: readonly string[];
  children?: ReactNode;
  description?: ReactNode;
  notice?: ReactNode;
  noticeLabel?: string;
  title: ReactNode;
}

export function PageHeader({
  actions,
  backHref,
  backLabel,
  badge,
  badgeIcon,
  breadcrumbs,
  children,
  description,
  notice,
  noticeLabel,
  title,
}: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-5 min-[1280px]:flex-row min-[1280px]:items-start min-[1280px]:justify-between">
      <div className="min-w-0">
        {breadcrumbs?.length ? (
          <nav
            aria-label="Хлебные крошки"
            className={cn(
              "text-copy-muted mb-8 flex w-full min-w-0 items-center gap-2 text-xs sm:text-sm",
            )}
          >
            <Breadcrumbs>
              {breadcrumbs.map((item) => (
                <Breadcrumbs.Item key={item}>{item}</Breadcrumbs.Item>
              ))}
            </Breadcrumbs>
          </nav>
        ) : null}
        {backHref && backLabel ? (
          <Link
            className="text-copy-muted hover:text-accent mb-5 inline-flex items-center gap-2 text-sm"
            to={backHref}
          >
            <UploadIcon className="size-4" name="arrow-left" />
            {backLabel}
          </Link>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-[clamp(2rem,3.2vw,3.25rem)] leading-[1.02] font-semibold tracking-[-0.045em] wrap-break-word">
            {title}
          </h1>
          {badge ? (
            <span className="bg-accent/10 text-accent inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold">
              {badgeIcon ? (
                <UploadIcon className="size-3.5" name={badgeIcon} />
              ) : null}
              {badge}
            </span>
          ) : null}
        </div>
        {description ? (
          <p className="text-copy-muted mt-3 max-w-3xl text-sm leading-6 sm:text-base">
            {description}
          </p>
        ) : null}
        {notice ? (
          <div
            className="bg-accent/5 text-copy-muted mt-4 flex w-fit max-w-3xl items-center gap-2 rounded-xl px-3 py-2 text-xs leading-5"
            role="note"
          >
            <span className="bg-accent/10 text-accent shrink-0 rounded-md px-2 py-0.5 font-semibold">
              {noticeLabel}
            </span>
            <span>{notice}</span>
          </div>
        ) : null}
        {children}
      </div>
      {actions ? (
        <div className="flex h-[stretch] shrink-0 flex-wrap items-start gap-2.5">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
