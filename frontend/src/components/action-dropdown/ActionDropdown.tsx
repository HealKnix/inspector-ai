import { Button, Description, Dropdown, Label, Spinner } from "@heroui/react";
import type { ReactNode } from "react";

import { UploadIcon } from "@/components/UploadIcon";
import { cn } from "@/lib/utils";

export interface ActionDropdownItem {
  label: string;
  onPress: () => void;
  className?: string;
  color?: "accent" | "danger" | "muted" | "success" | "warning";
  description?: string;
  icon?: ReactNode;
  isDisabled?: boolean;
  isLoading?: boolean;
}

interface ActionDropdownProps {
  actions: ActionDropdownItem[];
  ariaLabel?: string;
  className?: string;
}

const colorClasses: Record<NonNullable<ActionDropdownItem["color"]>, string> = {
  muted: "text-foreground",
  accent: "text-accent",
  danger: "text-danger",
  success: "text-success",
  warning: "text-warning",
};

export function ActionDropdown({
  actions,
  ariaLabel = "Действия",
  className,
}: ActionDropdownProps) {
  return (
    <Dropdown>
      <Button
        aria-label={ariaLabel}
        className={cn("rounded-xl", className)}
        isIconOnly
        variant="ghost"
      >
        <UploadIcon className="size-4" name="more" />
      </Button>
      <Dropdown.Popover placement="bottom end" className="max-w-64">
        <Dropdown.Menu
          onAction={(key) => {
            actions[Number(key)]?.onPress();
          }}
        >
          {actions.map((action, index) => {
            const colorClass = colorClasses[action.color ?? "muted"];

            return (
              <Dropdown.Item
                key={index}
                id={String(index)}
                isDisabled={action.isDisabled || action.isLoading}
                textValue={action.label}
                className={cn(
                  "group items-start",
                  colorClass,
                  action.className,
                )}
              >
                {action.isLoading ? (
                  <Spinner
                    color="current"
                    className="mt-0.75 size-4 shrink-0"
                    size="sm"
                  />
                ) : action.icon ? (
                  <span className="mt-0.75 shrink-0">{action.icon}</span>
                ) : null}
                <div className="flex flex-col self-center">
                  <Label className={colorClass}>{action.label}</Label>
                  {action.description && (
                    <Description>{action.description}</Description>
                  )}
                </div>
              </Dropdown.Item>
            );
          })}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
