import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CompletenessModule } from "../completeness/completeness.module.js";
import { ExtractionCoreModule } from "../extraction/extraction.module.js";
import { ObjectsModule } from "../objects/objects.module.js";
import { VerificationController } from "./verification.controller.js";
import { VerificationService } from "./verification.service.js";

@Module({
  imports: [
    AuthModule,
    ObjectsModule,
    ExtractionCoreModule,
    CompletenessModule,
  ],
  providers: [VerificationService],
  controllers: [VerificationController],
})
export class VerificationModule {}
