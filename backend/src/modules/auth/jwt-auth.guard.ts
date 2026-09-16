import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";

import {
  ACCESS_TOKEN_AUDIENCE,
  AUTH_TOKEN_ISSUER,
  JWT_ALGORITHM,
} from "../../common/const/auth.constants.js";
import { type PublicUser, UsersService } from "../users/users.service.js";
import { AuthSessionsService } from "./auth-sessions.service.js";

export interface AuthenticatedRequest extends Request {
  user: PublicUser;
}

interface RequestWithOptionalUser extends Request {
  user?: PublicUser;
}

function getBearerToken(request: Request): string | undefined {
  const [scheme, token] = request.headers.authorization?.split(" ") ?? [];
  return scheme?.toLowerCase() === "bearer" ? token : undefined;
}

function getAccessTokenSubject(
  payload: unknown,
): { sessionId: string; userId: string } | undefined {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }

  const tokenPayload = payload as Record<string, unknown>;
  const sessionId = tokenPayload.sid;
  const subject = tokenPayload.sub;
  const tokenId = tokenPayload.jti;
  const tokenType = tokenPayload.tokenType;

  if (
    typeof sessionId !== "string" ||
    sessionId.length === 0 ||
    typeof subject !== "string" ||
    subject.length === 0 ||
    typeof tokenId !== "string" ||
    tokenId.length === 0 ||
    tokenType !== "access"
  ) {
    return undefined;
  }

  return { sessionId, userId: subject };
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly authSessionsService: AuthSessionsService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<RequestWithOptionalUser>();
    const token = getBearerToken(request);

    if (!token) {
      throw new UnauthorizedException("Требуется вход в систему");
    }

    try {
      const payload: unknown = await this.jwtService.verifyAsync(token, {
        algorithms: [JWT_ALGORITHM],
        audience: ACCESS_TOKEN_AUDIENCE,
        issuer: AUTH_TOKEN_ISSUER,
        secret: this.configService.getOrThrow<string>("JWT_SECRET"),
      });
      const subject = getAccessTokenSubject(payload);

      if (!subject) {
        throw new Error("Токен доступа задан в неправильно формате");
      }

      if (
        !(await this.authSessionsService.isActive(
          subject.sessionId,
          subject.userId,
        ))
      ) {
        throw new Error("Сессия недействительна");
      }

      const user = await this.usersService.findById(subject.userId);

      if (!user) {
        throw new Error("Пользователь не найден");
      }

      request.user = user;
      return true;
    } catch {
      throw new UnauthorizedException("Сессия недействительна");
    }
  }
}
