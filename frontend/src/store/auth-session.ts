import { create } from "zustand";

import { Role, type UserDto } from "@/api/types/auth";

export interface AuthSessionState {
  accessToken: string | null;
  user: UserDto | null;
  initialized: boolean;
  clearSession: () => void;
  setInitialized: (value: boolean) => void;
  setSession: (accessToken: string, user: UserDto) => void;
  setUser: (user: UserDto | null) => void;
  getRole: () => Role | null;
  isAuth: () => boolean;
  isInspector: () => boolean;
  isAdmin: () => boolean;
  isMlEngineer: () => boolean;
}

export const useAuthSessionStore = create<AuthSessionState>((set, get) => ({
  accessToken: null,
  user: null,
  initialized: false,
  clearSession: () => {
    set({ accessToken: null, initialized: true, user: null });
  },
  setInitialized: (value) => {
    set({ initialized: value });
  },
  setSession: (accessToken, user) => {
    set({ accessToken, initialized: true, user });
  },
  setUser: (user) => {
    set({ user });
  },
  getRole: () => get().user?.role ?? null,
  isAuth: () => get().user !== null,
  isInspector: () => get().user?.role === Role.INSPECTOR,
  isAdmin: () => get().user?.role === Role.ADMINISTRATOR,
  isMlEngineer: () => get().user?.role === Role.ML_ENGINEER,
}));
