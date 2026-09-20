import { useCreateObject } from "@/api/hooks/use-objects";
import { UploadIcon } from "@/components/UploadIcon";
import routeNames from "@/routes/routeNames";
import { Button, FieldError, Input, Label, TextField } from "@heroui/react";
import { zodResolver } from "@hookform/resolvers/zod";
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
  const { control, handleSubmit } = useForm({
    defaultValues: { name: "" },
    resolver: zodResolver(schema),
  });
  const submit = handleSubmit(({ name }) =>
    mutation.mutate(name, {
      onSuccess: (object) => {
        void navigate(routeNames.OBJECT_DETAILS(object.id));
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
          Создайте карточку объекта и добавьте первый комплект документов.
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
