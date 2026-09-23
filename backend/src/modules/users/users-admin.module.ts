import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { UsersController } from "./users.controller.js";
import { UsersModule } from "./users.module.js";

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [UsersController],
})
export class UsersAdminModule {}
