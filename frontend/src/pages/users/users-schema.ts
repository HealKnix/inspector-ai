import { z } from "zod";

import { roleSchema } from "@/api/types/auth";
import {
  emailField,
  loginField,
  nameField,
  passwordField,
  phoneField,
  requiredNameField,
} from "@/lib/user-fields";

const profileFields = {
  lastName: requiredNameField("фамилию"),
  firstName: requiredNameField("имя"),
  patronymic: nameField,
  phone: phoneField,
  email: emailField,
};

export const createUserSchema = z
  .object({
    login: loginField,
    password: passwordField,
    passwordConfirmation: z.string(),
    ...profileFields,
    role: roleSchema,
  })
  .refine((values) => values.password === values.passwordConfirmation, {
    message: "Пароли не совпадают",
    path: ["passwordConfirmation"],
  });

export const updateUserSchema = z.object({
  ...profileFields,
  role: roleSchema.nullable(),
});

export type CreateUserFormValues = z.input<typeof createUserSchema>;
export type CreateUserSubmitValues = z.output<typeof createUserSchema>;
export type UpdateUserFormValues = z.input<typeof updateUserSchema>;
export type UpdateUserSubmitValues = z.output<typeof updateUserSchema>;
