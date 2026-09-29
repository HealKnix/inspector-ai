import {
  buttonVariants,
  Modal,
  type UseOverlayStateReturn,
} from "@heroui/react";
import type { ReactNode } from "react";

import { UploadIcon } from "@/components/UploadIcon";
import { cn } from "@/lib/utils";

export interface DocumentViewerModalProps {
  children?: ReactNode;
  contentClassName?: string;
  pageLabel: string;
  state?: UseOverlayStateReturn;
  title: string;
  toolbar?: ReactNode;
}

export function DocumentViewerModal({
  children,
  contentClassName,
  pageLabel,
  state,
  title,
  toolbar,
}: DocumentViewerModalProps) {
  return (
    <Modal state={state}>
      <Modal.Trigger
        tabIndex={state ? -1 : undefined}
        aria-label="Развернуть просмотр документа"
        className={cn(
          buttonVariants({ variant: "ghost", isIconOnly: true }),
          "text-copy-muted flex size-9 items-center justify-center rounded-lg",
          state && "sr-only",
        )}
      >
        <UploadIcon name="expand" />
      </Modal.Trigger>
      <Modal.Backdrop className="bg-backdrop backdrop-blur-sm">
        <Modal.Container scroll="inside" size="full">
          <Modal.Dialog className="border-border bg-background text-foreground overflow-hidden border p-0">
            <Modal.Header className="border-border relative flex flex-row items-center gap-3 border-b px-4 py-3 pr-14 sm:px-6 sm:pr-16">
              <Modal.Heading className="min-w-0 flex-1 truncate pr-2 text-base font-semibold">
                {title}
              </Modal.Heading>
              <span className="text-copy-muted hidden shrink-0 text-xs sm:inline">
                {pageLabel}
              </span>
              <Modal.CloseTrigger
                aria-label="Закрыть просмотр документа"
                className="top-1/2 right-2 size-8 -translate-y-1/2"
              >
                <UploadIcon className="size-4.5" name="close" />
              </Modal.CloseTrigger>
            </Modal.Header>
            <Modal.Body className="bg-surface-low mt-0 flex min-h-0 flex-col overflow-hidden p-0">
              {toolbar && (
                <div className="border-border bg-card flex flex-wrap items-center justify-center gap-2 border-b px-3 py-2 sm:px-5">
                  {toolbar}
                </div>
              )}
              <div
                className={cn("min-h-0 flex-1 overflow-auto", contentClassName)}
              >
                {children}
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
