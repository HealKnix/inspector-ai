import {
  Label,
  ToggleButton,
  ToggleButtonGroup,
  type Key,
} from "@heroui/react";

import { DocumentStage } from "@/pages/document-upload/types";

interface PackageStagePickerProps {
  isDisabled: boolean;
  onChange: (stage: DocumentStage) => void;
  value: DocumentStage;
}

const stageOptions = [
  { label: "Проектная (ПД)", value: DocumentStage.PD },
  { label: "Рабочая (РД)", value: DocumentStage.RD },
  { label: "Исполнительная (ИД)", value: DocumentStage.ID },
] as const;

export function PackageStagePicker({
  isDisabled,
  onChange,
  value,
}: PackageStagePickerProps) {
  const handleChange = (keys: Set<Key>) => {
    const selected = keys.values().next().value;
    if (
      selected === DocumentStage.PD ||
      selected === DocumentStage.RD ||
      selected === DocumentStage.ID
    ) {
      onChange(selected);
    }
  };

  return (
    <div className="border-border bg-card flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[20px] border px-4 py-3 shadow-sm sm:px-5">
      <Label className="text-copy-muted text-sm font-medium">
        Загружаемая документация:
      </Label>
      <ToggleButtonGroup
        aria-label="Стадия загружаемой документации"
        className="w-max gap-1"
        disallowEmptySelection
        isDetached
        isDisabled={isDisabled}
        onSelectionChange={handleChange}
        selectedKeys={new Set<Key>([value])}
        selectionMode="single"
        size="sm"
      >
        {stageOptions.map((option) => (
          <ToggleButton
            className="text-copy-muted data-[selected=true]:bg-accent/10 data-[selected=true]:text-accent rounded-full px-3"
            id={option.value}
            key={option.value}
            variant="ghost"
          >
            {option.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <p className="text-copy-muted text-xs leading-5 min-[1120px]:ml-auto">
        Стадия применяется ко всем файлам пакета и сверяется с распознанной
        после обработки.
      </p>
    </div>
  );
}
