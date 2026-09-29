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
              "ring-border bg-background text-copy-muted grid size-10 flex-none place-items-center rounded-full font-semibold ring-2 transition-colors",
              isComplete && "bg-accent text-accent-foreground ring-accent",
              isCurrent && "text-accent ring-accent",
            )}
          >
            {isComplete ? (
              <UploadIcon className="size-5" name="check" strokeWidth={2} />
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
              <>
                <div
                  aria-hidden="true"
                  className="bg-border absolute top-5 h-0.75 -translate-y-1/2"
                  style={{
                    left: "calc(-50% + 22px)",
                    right: "calc(50% + 22px)",
                  }}
                >
                  <div
                    aria-hidden="true"
                    className={cn(
                      "bg-accent h-full w-0 transition-all duration-250",
                      isReached && "w-full",
                    )}
                  />
                </div>
              </>
            ) : null}
            {onStepClick ? (
              <button
                aria-label={`Шаг ${stepNumber}: ${step.label}`}
                className="focus-visible:ring-ring flex min-w-0 flex-col items-center rounded-2xl px-2 transition-all outline-none hover:opacity-75 focus-visible:ring-2 active:opacity-60"
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
