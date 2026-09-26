import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ObjectsModule } from "../objects/objects.module.js";
import { ParsingCoreModule } from "../parsing/parsing.module.js";
import { ClassificationJobsService } from "./classification-jobs.service.js";
import { ClassificationController } from "./classification.controller.js";
import { ClassificationService } from "./classification.service.js";
import { IdentificationCoreModule } from "./identification.module.js";

@Module({
  imports: [ObjectsModule, ParsingCoreModule],
  providers: [ClassificationJobsService],
  exports: [ClassificationJobsService],
})
export class ClassificationCoreModule {}

@Module({
  imports: [
    AuthModule,
    ObjectsModule,
    ClassificationCoreModule,
    IdentificationCoreModule,
  ],
  providers: [ClassificationService],
  controllers: [ClassificationController],
})
export class ClassificationModule {}
