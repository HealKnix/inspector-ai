import type {
  IdentificationEvidence,
  IdentificationField,
  IdentificationRevision,
} from "@/api/types/identification";
import { IdentificationSelect } from "@/components/identification-select/IdentificationSelect";
import { Input } from "@/components/input/Input";
import type { ChangeEvent } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";
import { reviewFieldLabels } from "../lib/review-card";
import type { ReviewFormValues } from "../lib/review-form";

export function ReviewFields({
  fields,
  form,
  revision,
  stage,
  kinds,
  disabled,
  onEvidence,
}: {
  fields: IdentificationField[];
  form: UseFormReturn<ReviewFormValues>;
  revision: IdentificationRevision;
  stage?: string;
  kinds: { id: string; label: string }[];
  disabled: boolean;
  onEvidence: (evidence: IdentificationEvidence | null) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((fieldName) => (
        <Controller
          key={fieldName}
          control={form.control}
          name={`fields.${fieldName}`}
          render={({ field }) => {
            const showSource = (value: string) =>
              onEvidence(
                revision.candidates.find(
                  (candidate) =>
                    candidate.field === fieldName &&
                    candidate.role === "own" &&
                    candidate.normalized?.trim() === value.trim(),
                )?.evidence[0] ?? null,
              );
            return fieldName === "kind_code" || fieldName === "stage" ? (
              <div className="sm:col-span-2">
                <IdentificationSelect
                  label={reviewFieldLabels[fieldName]!}
                  value={field.value ?? ""}
                  onChange={(value) => {
                    field.onChange(value);
                    if (fieldName === "stage")
                      form.setValue("fields.kind_code", "", {
                        shouldDirty: true,
                      });
                    showSource(value);
                  }}
                  disabled={
                    disabled ||
                    (fieldName === "kind_code" && kinds.length === 0)
                  }
                  options={
                    fieldName === "stage"
                      ? [
                          { id: "PD", label: "Проектная документация" },
                          { id: "RD", label: "Рабочая документация" },
                          { id: "ID", label: "Исполнительная документация" },
                        ]
                      : kinds
                  }
                />
              </div>
            ) : (
              <Input
                {...field}
                className={fieldName === "scope" ? "sm:col-span-2" : undefined}
                value={field.value ?? ""}
                onFocus={() => showSource(field.value ?? "")}
                onChange={(event: ChangeEvent<HTMLInputElement>) => {
                  field.onChange(event);
                  showSource(event.target.value);
                }}
                label={
                  fieldName === "scope" && stage !== "ID"
                    ? "Область применения / часть объекта"
                    : reviewFieldLabels[fieldName]
                }
                type={
                  ["date", "works_from", "works_to"].includes(fieldName)
                    ? "date"
                    : "text"
                }
                isDisabled={disabled}
                errorMessage={
                  form.formState.errors.fields?.[fieldName]?.message
                }
              />
            );
          }}
        />
      ))}
    </div>
  );
}
