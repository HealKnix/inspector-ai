import type { ReactNode } from "react";

import { UploadIcon } from "@/components/UploadIcon";
import { cn } from "@/lib/utils";

export interface StepperStep {
  description?: ReactNode;
  label: string;
}

interface StepperProps {
  "aria-label"?: string;
  className?: string;
  currentStep: number;
  onStepClick?: (step: number) => void;
  steps: readonly StepperStep[];
}

export function Stepper({
  "aria-label": ariaLabel,
  className,
  currentStep,
  onStepClick,
  steps,
}: StepperProps) {
  return (
    <ol
      aria-label={ariaLabel}
      className={cn("flex w-full overflow-x-auto pt-1", className)}
    >
      {steps.map((step, index) => {
        const stepNumber = index + 1;
        const isComplete = stepNumber < currentStep;
        const isCurrent = stepNumber === currentStep;
        const isReached = isComplete || isCurrent;

        const marker = (
          <span
            className={cn(
              "ring-border grid size-10 flex-none place-items-center rounded-full font-semibold ring-2 transition-colors",
              isComplete && "bg-accent text-accent-foreground ring-accent",
              isCurrent && "bg-background text-accent ring-accent",
              !isReached && "bg-surface-raised text-copy-muted",
            )}
          >
            {isComplete ? (
              <UploadIcon className="size-5" name="check" />
            ) : (
              stepNumber
            )}
          </span>
        );

        const label = (
          <span className="mt-4 flex max-w-full min-w-0 flex-col items-center gap-1 text-center">
            <span
              className={cn(
                "max-w-full truncate text-sm font-semibold",
                isReached ? "text-foreground" : "text-copy-muted",
              )}
            >
              {step.label}
            </span>
            {step.description ? (
              <span className="text-copy-muted max-w-full truncate text-xs leading-5">
                {step.description}
              </span>
            ) : null}
          </span>
        );

        return (
          <li
            aria-current={isCurrent ? "step" : undefined}
            className="relative flex min-w-42 flex-1 flex-col items-center"
            key={step.label}
          >
            {index > 0 ? (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute top-5 h-0.75 -translate-y-1/2 transition-colors",
                  isReached ? "bg-accent" : "bg-line",
                )}
                style={{
                  left: "calc(-50% + 22px)",
                  right: "calc(50% + 22px)",
                }}
              />
            ) : null}
            {onStepClick ? (
              <button
                aria-label={`Шаг ${stepNumber}: ${step.label}`}
                className="focus-visible:ring-ring flex min-w-0 flex-col items-center rounded-2xl px-2 outline-none focus-visible:ring-2"
                onClick={() => onStepClick(stepNumber)}
                type="button"
              >
                {marker}
                {label}
              </button>
            ) : (
              <>
                {marker}
                {label}
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}
