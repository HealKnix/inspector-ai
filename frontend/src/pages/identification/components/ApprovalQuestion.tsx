import { IdentificationSelect } from "@/components/identification-select/IdentificationSelect";
import { Input } from "@/components/input/Input";
import { Checkbox } from "@heroui/react";
import { Controller, type UseFormReturn } from "react-hook-form";
import type { ReviewFormValues } from "../lib/review-form";

export function ApprovalQuestion({
  form,
  disabled,
  replacementName,
  replacementOptions,
}: {
  form: UseFormReturn<ReviewFormValues>;
  disabled: boolean;
  replacementName?: string;
  replacementOptions: { id: string; label: string }[];
}) {
  const {
    control,
    setValue,
    formState: { errors },
  } = form;
  const changed = () => setValue("approvalChanged", true);
  return (
    <details className="space-y-3">
      <summary className="cursor-pointer text-sm underline">
        Уточнить утверждение редакции
      </summary>
      <p className="text-copy-muted text-sm">
        Заполняйте только при наличии основания утверждения и периода действия
        этой редакции.
      </p>
      <Controller
        control={control}
        name="confirmed"
        render={({ field }) => (
          <Checkbox
            isSelected={field.value}
            isDisabled={disabled}
            onChange={(value) => {
              changed();
              field.onChange(value);
            }}
          >
            <Checkbox.Content>
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              Утверждение редакции подтверждено
            </Checkbox.Content>
          </Checkbox>
        )}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Controller
          control={control}
          name="effectiveFrom"
          render={({ field }) => (
            <Input
              {...field}
              value={field.value}
              onChange={(event) => {
                changed();
                field.onChange(event);
              }}
              type="date"
              label="Действует с"
              isDisabled={disabled}
            />
          )}
        />
        <Controller
          control={control}
          name="effectiveTo"
          render={({ field }) => (
            <Input
              {...field}
              value={field.value}
              onChange={(event) => {
                changed();
                field.onChange(event);
              }}
              type="date"
              label="Действует по"
              isDisabled={disabled}
              errorMessage={errors.effectiveTo?.message}
            />
          )}
        />
      </div>
      <Controller
        control={control}
        name="approvalBasis"
        render={({ field }) => (
          <Input
            {...field}
            value={field.value}
            onChange={(event) => {
              changed();
              field.onChange(event);
            }}
            label="Основание утверждения"
            isDisabled={disabled}
            errorMessage={errors.approvalBasis?.message}
          />
        )}
      />
      {replacementName ? (
        <p className="text-copy-muted text-sm">Заменяет: {replacementName}</p>
      ) : null}
      {replacementOptions.length ? (
        <Controller
          control={control}
          name="replaces"
          render={({ field }) => (
            <IdentificationSelect
              label="Заменяет редакцию целиком"
              value={field.value}
              onChange={(value) => {
                changed();
                field.onChange(value);
              }}
              disabled={disabled}
              options={replacementOptions}
            />
          )}
        />
      ) : null}
    </details>
  );
}
