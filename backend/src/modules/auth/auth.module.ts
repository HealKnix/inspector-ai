import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";

import { RolesGuard } from "../../common/guards/roles.guard.js";
import { UsersModule } from "../users/users.module.js";
import { AuthRequestGuard } from "./auth-request.guard.js";
import { AuthSessionsService } from "./auth-sessions.service.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { JwtAuthGuard } from "./jwt-auth.guard.js";
import { PasswordService } from "./password.service.js";

@Module({
  imports: [UsersModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthRequestGuard,
    AuthService,
    AuthSessionsService,
    JwtAuthGuard,
    PasswordService,
    RolesGuard,
  ],
})
export class AuthModule {}
