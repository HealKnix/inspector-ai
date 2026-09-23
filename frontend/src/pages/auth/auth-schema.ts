import { z } from "zod";

import {
  emailField,
  loginField,
  nameField,
  passwordField,
  phoneField,
  requiredNameField,
} from "@/lib/user-fields";

export const loginSchema = z.object({
  login: loginField,
  password: z
    .string()
    .min(1, "Введите пароль")
    .max(128, "Пароль слишком длинный"),
});

export const registerSchema = z
  .object({
    login: loginField,
    password: passwordField,
    passwordConfirmation: z.string(),
    lastName: requiredNameField("фамилию"),
    firstName: requiredNameField("имя"),
    patronymic: nameField,
    phone: phoneField,
    email: emailField,
  })
  .refine((values) => values.password === values.passwordConfirmation, {
    message: "Пароли не совпадают",
    path: ["passwordConfirmation"],
  });

export type LoginFormValues = z.input<typeof loginSchema>;
export type RegisterFormValues = z.input<typeof registerSchema>;
export type RegisterSubmitValues = z.output<typeof registerSchema>;
