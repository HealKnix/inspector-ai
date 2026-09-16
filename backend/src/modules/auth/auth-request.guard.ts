import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";

import {
  AUTH_REQUEST_HEADER,
  AUTH_REQUEST_HEADER_VALUE,
} from "../../common/const/auth.constants.js";

@Injectable()
export class AuthRequestGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (request.get(AUTH_REQUEST_HEADER) !== AUTH_REQUEST_HEADER_VALUE) {
      throw new ForbiddenException("Запрос не прошёл проверку источника");
    }

    return true;
  }
}
