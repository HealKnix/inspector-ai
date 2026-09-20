import { generateExpectedPackage } from "@/api/endpoints/completeness";
import { useCreateObject } from "@/api/hooks/use-objects";
import {
  draftToAttributes,
  emptyAttributesDraft,
  type AttributesDraft,
} from "@/components/attributes-draft";
import { AttributesEditor } from "@/components/AttributesEditor";
import { UploadIcon } from "@/components/UploadIcon";
import routeNames from "@/routes/routeNames";
import { Button, FieldError, Input, Label, TextField } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Введите название объекта")
    .max(300, "Не более 300 символов"),
});

export function CreateObjectForm() {
  const mutation = useCreateObject();
  const navigate = useNavigate();
  const [attributes, setAttributes] =
    useState<AttributesDraft>(emptyAttributesDraft);
  const { control, handleSubmit } = useForm({
    defaultValues: { name: "" },
    resolver: zodResolver(schema),
  });
  const submit = handleSubmit(({ name }) =>
    mutation.mutate(name, {
      onSuccess: (object) => {
        void generateExpectedPackage({
          objectId: object.id,
          attributes: draftToAttributes(attributes),
        })
          .catch(() => undefined)
          .finally(() => {
            void navigate(routeNames.OBJECT_UPLOAD(object.id));
          });
      },
    }),
  );
  return (
    <form
      className="border-border bg-card flex h-full flex-col gap-4 rounded-[25px] border p-6 sm:p-7"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <div>
        <h2 className="text-lg font-semibold">Новый объект</h2>
        <p className="text-copy-muted mt-1 text-sm leading-6">
          Создайте карточку объекта и задайте эталонный состав документации.
        </p>
      </div>
      <Controller
        control={control}
        name="name"
        render={({ field, fieldState }) => (
          <TextField isRequired isInvalid={fieldState.invalid}>
            <Label>Название объекта</Label>
            <Input
              {...field}
              className="rounded-xl"
              maxLength={300}
              placeholder="Например, жилой корпус 1"
            />
            <FieldError>{fieldState.error?.message}</FieldError>
          </TextField>
        )}
      />
      <AttributesEditor draft={attributes} onChange={setAttributes} />
      {mutation.error && (
        <p role="alert" className="text-danger">
          {mutation.error.message}
        </p>
      )}
      <Button
        className="mt-auto self-start rounded-xl"
        type="submit"
        isPending={mutation.isPending}
      >
        <UploadIcon className="size-4.5" name="plus" />
        Создать объект
      </Button>
    </form>
  );
}
