import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CompletenessModule } from "../completeness/completeness.module.js";
import { ExtractionCoreModule } from "../extraction/extraction.module.js";
import { SectionAnalysisJobsService } from "../extraction/section-analysis-jobs.service.js";
import { ObjectsModule } from "../objects/objects.module.js";
import {
  SECTION_ANALYSIS_PORT,
  type SectionResultsPort,
} from "./section-findings.js";
import { VerificationController } from "./verification.controller.js";
import { VerificationService } from "./verification.service.js";

@Module({
  imports: [
    AuthModule,
    ObjectsModule,
    ExtractionCoreModule,
    CompletenessModule,
  ],
  providers: [
    VerificationService,
    // Реальная привязка порта к персистентности: selectedTask реализован в
    // SectionAnalysisJobsService (ExtractionCoreModule), заглушек нет.
    {
      provide: SECTION_ANALYSIS_PORT,
      useExisting: SectionAnalysisJobsService,
    } satisfies {
      provide: string;
      useExisting: new (...args: never[]) => SectionResultsPort;
    },
  ],
  controllers: [VerificationController],
})
export class VerificationModule {}
