import { z } from "zod";

const loginField = z
  .string()
  .trim()
  .transform((value) => value.normalize("NFC"))
  .pipe(
    z
      .string()
      .min(3, "Введите не менее 3 символов")
      .max(64, "Введите не более 64 символов")
      .regex(/^[^\s\p{Cc}\p{Cf}]+$/u, "Уберите пробелы и управляющие символы"),
  )
  .transform((value) => value.toLowerCase());

const passwordField = z
  .string()
  .min(12, "Пароль должен содержать не менее 12 символов")
  .max(128, "Пароль должен содержать не более 128 символов");

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
  })
  .refine((values) => values.password === values.passwordConfirmation, {
    message: "Пароли не совпадают",
    path: ["passwordConfirmation"],
  });

export type LoginFormValues = z.input<typeof loginSchema>;
export type RegisterFormValues = z.input<typeof registerSchema>;
