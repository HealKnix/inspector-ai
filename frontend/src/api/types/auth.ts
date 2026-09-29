import { z } from "zod";

export const Role = {
  ADMINISTRATOR: "ADMINISTRATOR",
  INSPECTOR: "INSPECTOR",
  ML_ENGINEER: "ML_ENGINEER",
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const roleSchema = z.enum([
  Role.INSPECTOR,
  Role.ADMINISTRATOR,
  Role.ML_ENGINEER,
]);

export const roleLabels: Record<Role, string> = {
  [Role.ADMINISTRATOR]: "Администратор",
  [Role.INSPECTOR]: "Инспектор",
  [Role.ML_ENGINEER]: "ML-инженер",
};

export const userSchema = z.object({
  id: z.string().uuid(),
  login: z.string().min(1),
  role: roleSchema.nullable(),
  lastName: z.string().min(1),
  firstName: z.string().min(1),
  patronymic: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().nullish(),
  createdAt: z.string().datetime(),
});

export const currentUserResponseSchema = z.object({
  user: userSchema,
});

export const authSessionResponseSchema = currentUserResponseSchema.extend({
  accessToken: z.string().min(1),
});

export type UserDto = z.infer<typeof userSchema>;
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;

export interface LoginRequest {
  login: string;
  password: string;
}

export interface RegisterRequest extends LoginRequest {
  email?: string;
  firstName: string;
  lastName: string;
  patronymic?: string;
  phone?: string;
}
