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

const nameField = z
  .string()
  .trim()
  .max(100, "Введите не более 100 символов")
  .transform((value) => value.normalize("NFC") || undefined);

const requiredNameField = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `Укажите ${label}`)
    .max(100, "Введите не более 100 символов")
    .transform((value) => value.normalize("NFC"));

const phoneField = z
  .string()
  .trim()
  .max(32, "Введите не более 32 символов")
  .refine(
    (value) => value === "" || /^\+?[0-9][0-9\s()-]{4,30}$/.test(value),
    "Введите корректный номер телефона",
  )
  .transform((value) => value || undefined);

const emailField = z
  .string()
  .trim()
  .max(320, "Введите не более 320 символов")
  .refine(
    (value) => value === "" || z.email().safeParse(value).success,
    "Введите корректный email",
  )
  .transform((value) => value || undefined);

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
