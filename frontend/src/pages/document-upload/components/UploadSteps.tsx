import { Stepper } from "@/components/stepper/Stepper";

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
    <Stepper
      aria-label="Этапы загрузки"
      className="mt-7 sm:mt-9"
      currentStep={activeStep}
      steps={steps}
    />
  );
}
