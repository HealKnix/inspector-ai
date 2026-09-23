import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { ParsingCoreModule } from "../parsing/parsing.module.js";
import { DocumentsAdminController } from "./documents-admin.controller.js";

@Module({
  imports: [AuthModule, ParsingCoreModule],
  controllers: [DocumentsAdminController],
})
export class DocumentsAdminModule {}
