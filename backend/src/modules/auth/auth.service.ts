import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomUUID } from "node:crypto";

import {
  ACCESS_TOKEN_AUDIENCE,
  AUTH_TOKEN_ISSUER,
  JWT_ALGORITHM,
  REFRESH_TOKEN_AUDIENCE,
} from "../../common/const/auth.constants.js";
import { type PublicUser, UsersService } from "../users/users.service.js";
import { AuthSessionsService } from "./auth-sessions.service.js";
import { PasswordService } from "./password.service.js";

export interface SessionResult {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

interface RefreshTokenPayload {
  jti: string;
  sid: string;
  sub: string;
  tokenType: "refresh";
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const INVALID_ACCOUNT_HASH =
  "scrypt$1$131072$8$1$SUlJSUlJSUlJSUlJSUlJSQ$w3FYtB96lOs7Eqbd1RXsEMNPmFxO9sFtz6hwZdGsHJfnHvnytGrooEyXpiizW6N-SWnoSjVX4kRyY1ye6pVtig";

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}

function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function getRefreshTokenPayload(
  payload: unknown,
): RefreshTokenPayload | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }

  const tokenPayload = payload as Record<string, unknown>;
  const jti = tokenPayload.jti;
  const sessionId = tokenPayload.sid;
  const subject = tokenPayload.sub;
  const tokenType = tokenPayload.tokenType;

  if (
    typeof jti !== "string" ||
    jti.length === 0 ||
    typeof sessionId !== "string" ||
    sessionId.length === 0 ||
    typeof subject !== "string" ||
    subject.length === 0 ||
    tokenType !== "refresh"
  ) {
    return undefined;
  }

  return { jti, sid: sessionId, sub: subject, tokenType };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly authSessionsService: AuthSessionsService,
  ) {}

  async register(login: string, password: string): Promise<SessionResult> {
    const normalizedLogin = login.trim().normalize("NFC").toLowerCase();
    const existingUser =
      await this.usersService.findCredentialsByLogin(normalizedLogin);

    if (existingUser) {
      throw new ConflictException(
        "Пользователь с таким логином уже зарегистрирован",
      );
    }

    const passwordHash = await this.passwordService.hash(password);

    try {
      const user = await this.usersService.create(
        normalizedLogin,
        passwordHash,
      );
      return this.createSession(user);
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException(
          "Пользователь с таким логином уже зарегистрирован",
        );
      }

      throw error;
    }
  }

  async login(login: string, password: string): Promise<SessionResult> {
    const normalizedLogin = login.trim().normalize("NFC").toLowerCase();
    const user =
      await this.usersService.findCredentialsByLogin(normalizedLogin);
    const passwordMatches = await this.passwordService.verify(
      password,
      user?.passwordHash ?? INVALID_ACCOUNT_HASH,
    );

    if (!user || !passwordMatches) {
      throw new UnauthorizedException("Неверный логин или пароль");
    }

    return this.createSession({
      id: user.id,
      login: user.login,
      role: user.role,
      createdAt: user.createdAt,
    });
  }

  async refresh(refreshToken?: string): Promise<SessionResult> {
    if (!refreshToken) {
      throw new UnauthorizedException("Требуется обновление сессии");
    }

    const payload = await this.verifyRefreshToken(refreshToken);
    const user = await this.usersService.findById(payload.sub);

    if (!user) {
      throw new UnauthorizedException("Сессия недействительна");
    }

    const nextTokens = await this.createTokenPair(payload.sub, payload.sid);
    const refreshTokenTtlSeconds = this.configService.getOrThrow<number>(
      "JWT_REFRESH_TTL_SECONDS",
    );
    const rotated = await this.authSessionsService.rotate({
      currentRefreshTokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + refreshTokenTtlSeconds * 1000),
      id: payload.sid,
      refreshTokenHash: hashRefreshToken(nextTokens.refreshToken),
      userId: payload.sub,
    });

    if (!rotated) {
      throw new UnauthorizedException("Сессия недействительна");
    }

    return this.toSessionResult(nextTokens, user);
  }

  async logout(refreshToken?: string): Promise<void> {
    if (!refreshToken) {
      return;
    }

    let payload: RefreshTokenPayload;

    try {
      payload = await this.verifyRefreshToken(refreshToken);
    } catch {
      // Invalid tokens do not reveal whether a server-side session exists.
      return;
    }

    await this.authSessionsService.revoke(
      payload.sid,
      payload.sub,
      hashRefreshToken(refreshToken),
    );
  }

  async getCurrentUser(userId: string): Promise<PublicUser> {
    const user = await this.usersService.findById(userId);

    if (!user) {
      throw new UnauthorizedException("Сессия недействительна");
    }

    return user;
  }

  private async createSession(user: PublicUser): Promise<SessionResult> {
    const sessionId = randomUUID();
    const tokens = await this.createTokenPair(user.id, sessionId);
    const refreshTokenTtlSeconds = this.configService.getOrThrow<number>(
      "JWT_REFRESH_TTL_SECONDS",
    );

    await this.authSessionsService.create({
      expiresAt: new Date(Date.now() + refreshTokenTtlSeconds * 1000),
      id: sessionId,
      refreshTokenHash: hashRefreshToken(tokens.refreshToken),
      userId: user.id,
    });

    return this.toSessionResult(tokens, user);
  }

  private async createTokenPair(
    userId: string,
    sessionId: string,
  ): Promise<TokenPair> {
    const accessTokenTtlSeconds = this.configService.getOrThrow<number>(
      "JWT_ACCESS_TTL_SECONDS",
    );
    const refreshTokenTtlSeconds = this.configService.getOrThrow<number>(
      "JWT_REFRESH_TTL_SECONDS",
    );

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(
        {
          jti: randomUUID(),
          sid: sessionId,
          sub: userId,
          tokenType: "access",
        },
        {
          algorithm: JWT_ALGORITHM,
          audience: ACCESS_TOKEN_AUDIENCE,
          expiresIn: accessTokenTtlSeconds,
          issuer: AUTH_TOKEN_ISSUER,
          secret: this.configService.getOrThrow<string>("JWT_SECRET"),
        },
      ),
      this.jwtService.signAsync(
        {
          jti: randomUUID(),
          sid: sessionId,
          sub: userId,
          tokenType: "refresh",
        },
        {
          algorithm: JWT_ALGORITHM,
          audience: REFRESH_TOKEN_AUDIENCE,
          expiresIn: refreshTokenTtlSeconds,
          issuer: AUTH_TOKEN_ISSUER,
          secret: this.configService.getOrThrow<string>("JWT_REFRESH_SECRET"),
        },
      ),
    ]);

    return { accessToken, refreshToken };
  }

  private async verifyRefreshToken(
    refreshToken: string,
  ): Promise<RefreshTokenPayload> {
    try {
      const payload: unknown = await this.jwtService.verifyAsync(refreshToken, {
        algorithms: [JWT_ALGORITHM],
        audience: REFRESH_TOKEN_AUDIENCE,
        issuer: AUTH_TOKEN_ISSUER,
        secret: this.configService.getOrThrow<string>("JWT_REFRESH_SECRET"),
      });
      const refreshTokenPayload = getRefreshTokenPayload(payload);

      if (!refreshTokenPayload) {
        throw new Error("Invalid refresh token payload");
      }

      return refreshTokenPayload;
    } catch {
      throw new UnauthorizedException("Сессия недействительна");
    }
  }

  private toSessionResult(tokens: TokenPair, user: PublicUser): SessionResult {
    return { ...tokens, user };
  }
}
