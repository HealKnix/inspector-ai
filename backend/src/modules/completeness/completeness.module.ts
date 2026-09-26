import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ObjectsModule } from "../objects/objects.module.js";
import { ParsingCoreModule } from "../parsing/parsing.module.js";
import { CompletenessController } from "./completeness.controller.js";
import { CompletenessService } from "./completeness.service.js";

@Module({
  imports: [AuthModule, ObjectsModule, ParsingCoreModule],
  providers: [CompletenessService],
  controllers: [CompletenessController],
  exports: [CompletenessService],
})
export class CompletenessModule {}
