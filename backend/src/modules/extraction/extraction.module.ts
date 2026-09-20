import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ObjectsModule } from "../objects/objects.module.js";
import { ParsingCoreModule } from "../parsing/parsing.module.js";
import { ExtractionJobsService } from "./extraction-jobs.service.js";
import { ExtractionController } from "./extraction.controller.js";
import { ExtractionService } from "./extraction.service.js";
import { MatrixAdminController } from "./matrix-admin.controller.js";
import { MatrixAdminService } from "./matrix-admin.service.js";

@Module({
  imports: [ObjectsModule, ParsingCoreModule],
  providers: [ExtractionJobsService],
  exports: [ExtractionJobsService],
})
export class ExtractionCoreModule {}

@Module({
  imports: [AuthModule, ObjectsModule, ExtractionCoreModule, ParsingCoreModule],
  providers: [ExtractionService, MatrixAdminService],
  controllers: [ExtractionController, MatrixAdminController],
})
export class ExtractionModule {}
