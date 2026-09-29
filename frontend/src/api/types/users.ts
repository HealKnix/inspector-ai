import { z } from "zod";

import { userSchema, type Role } from "./auth";

export const adminUsersSchema = z.array(userSchema);

export interface CreateUserRequest {
  email?: string;
  firstName: string;
  lastName: string;
  login: string;
  password: string;
  patronymic?: string;
  phone?: string;
  role?: Role;
}

export interface UpdateUserRequest {
  email?: string | null;
  firstName?: string;
  lastName?: string;
  patronymic?: string | null;
  phone?: string | null;
  role?: Role | null;
}
