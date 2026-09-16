import { Role, type UserDto } from "@/api/types/auth";
import { useAuthSessionStore } from "@/store/auth-session";

function createUser(role: Role | null): UserDto {
  return {
    id: "27b43d75-2f24-4ff0-8bd8-d4758cfbd3cb",
    login: "inspector",
    role,
    createdAt: "2026-09-16T08:00:00.000Z",
  };
}

beforeEach(() => {
  useAuthSessionStore.setState({
    accessToken: null,
    initialized: false,
    user: null,
  });
});

describe("auth session store", () => {
  it("stores the authenticated user and session state in memory", () => {
    const user = createUser(Role.INSPECTOR);

    useAuthSessionStore.getState().setSession("access-token", user);

    const state = useAuthSessionStore.getState();
    expect(state.accessToken).toBe("access-token");
    expect(state.user).toEqual(user);
    expect(state.initialized).toBe(true);
    expect(state.getRole()).toBe(Role.INSPECTOR);
    expect(state.isAuth()).toBe(true);
  });

  it.each([
    [Role.INSPECTOR, true, false, false],
    [Role.ADMINISTRATOR, false, true, false],
    [Role.ML_ENGINEER, false, false, true],
    [null, false, false, false],
  ] as const)(
    "checks the %s role",
    (role, isInspector, isAdmin, isMlEngineer) => {
      useAuthSessionStore.getState().setUser(createUser(role));

      const state = useAuthSessionStore.getState();
      expect(state.isInspector()).toBe(isInspector);
      expect(state.isAdmin()).toBe(isAdmin);
      expect(state.isMlEngineer()).toBe(isMlEngineer);
    },
  );

  it("treats a user without an assigned role as authenticated", () => {
    useAuthSessionStore.getState().setUser(createUser(null));

    const state = useAuthSessionStore.getState();
    expect(state.getRole()).toBeNull();
    expect(state.isAuth()).toBe(true);
  });

  it("clears both the token and user", () => {
    useAuthSessionStore
      .getState()
      .setSession("access-token", createUser(Role.ADMINISTRATOR));

    useAuthSessionStore.getState().clearSession();

    const state = useAuthSessionStore.getState();
    expect(state.accessToken).toBeNull();
    expect(state.user).toBeNull();
    expect(state.initialized).toBe(true);
    expect(state.isAuth()).toBe(false);
    expect(state.getRole()).toBeNull();
  });
});
