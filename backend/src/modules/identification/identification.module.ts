import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CompletenessModule } from "../completeness/completeness.module.js";
import { ObjectsModule } from "../objects/objects.module.js";
import { ParsingCoreModule } from "../parsing/parsing.module.js";
import { IdentificationJobsService } from "./identification-jobs.service.js";
import { IdentificationController } from "./identification.controller.js";
import { IdentificationService } from "./identification.service.js";

@Module({
  imports: [ObjectsModule, ParsingCoreModule, CompletenessModule],
  providers: [IdentificationService, IdentificationJobsService],
  exports: [IdentificationService, IdentificationJobsService],
})
export class IdentificationCoreModule {}

@Module({
  imports: [AuthModule, IdentificationCoreModule],
  controllers: [IdentificationController],
})
export class IdentificationModule {}
