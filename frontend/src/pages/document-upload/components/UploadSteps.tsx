import { UploadIcon } from "@/components/UploadIcon";

const steps = [
  { label: "Файлы", description: "Загрузка документов" },
  { label: "Метаданные", description: "Автоматическое определение" },
  { label: "Комплектность", description: "Проверка состава" },
  { label: "Запуск", description: "Подготовка анализа" },
] as const;

interface UploadStepsProps {
  activeStep?: number;
}

export function UploadSteps({ activeStep = 1 }: UploadStepsProps) {
  return (
    <ol
      aria-label="Этапы загрузки"
      className="mt-7 flex snap-x snap-mandatory gap-5 overflow-x-auto pb-2 min-[980px]:grid min-[980px]:grid-cols-4 min-[980px]:overflow-visible sm:mt-9"
    >
      {steps.map((step, index) => {
        const number = index + 1;
        const isActive = number === activeStep;
        const isComplete = number < activeStep;

        return (
          <li
            aria-current={isActive ? "step" : undefined}
            className="flex min-w-[210px] snap-start items-center gap-3 min-[980px]:min-w-0"
            key={step.label}
          >
            <span
              className={`grid size-11 shrink-0 place-items-center rounded-full text-sm font-semibold transition-colors ${
                isActive || isComplete
                  ? "bg-accent text-accent-foreground"
                  : "bg-surface-raised text-copy-muted"
              }`}
            >
              {isComplete ? (
                <UploadIcon className="size-5" name="check" />
              ) : (
                number
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={`block text-sm font-semibold ${isActive ? "text-accent" : "text-foreground"}`}
              >
                {number}. {step.label}
              </span>
              <span className="text-copy-muted mt-0.5 block truncate text-xs">
                {step.description}
              </span>
            </span>
            {index < steps.length - 1 ? (
              <span className="bg-border hidden h-px min-w-6 flex-1 min-[980px]:block" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
