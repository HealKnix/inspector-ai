import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuthModule } from "../auth/auth.module.js";
import { ObjectsModule } from "../objects/objects.module.js";
import { ParsingCoreModule } from "../parsing/parsing.module.js";
import { ExtractionJobsService } from "./extraction-jobs.service.js";
import { ExtractionController } from "./extraction.controller.js";
import { ExtractionService } from "./extraction.service.js";
import { MatrixAdminController } from "./matrix-admin.controller.js";
import { MatrixAdminService } from "./matrix-admin.service.js";
import { MatrixReviewService } from "./matrix-review.service.js";
import { RuleSetReleaseController } from "./rule-set-release.controller.js";
import { RuleSetReleaseService } from "./rule-set-release.service.js";
import {
  SECTION_ANALYSIS_EXECUTOR,
  SectionAnalysisJobsService,
  sectionExecutorFromConfig,
} from "./section-analysis-jobs.service.js";
import { SectionAnalysisController } from "./section-analysis.controller.js";
import { SectionAnalysisService } from "./section-analysis.service.js";

@Module({
  imports: [ObjectsModule, ParsingCoreModule],
  providers: [
    ExtractionJobsService,
    SectionAnalysisJobsService,
    // Real engine adapter over the live section configuration; an absent or
    // invalid SECTION_LLM_* setup yields a disabled executor, never a fake.
    {
      provide: SECTION_ANALYSIS_EXECUTOR,
      useFactory: sectionExecutorFromConfig,
      inject: [ConfigService],
    },
  ],
  exports: [ExtractionJobsService, SectionAnalysisJobsService],
})
export class ExtractionCoreModule {}

@Module({
  imports: [AuthModule, ObjectsModule, ExtractionCoreModule, ParsingCoreModule],
  providers: [
    ExtractionService,
    MatrixAdminService,
    MatrixReviewService,
    RuleSetReleaseService,
    SectionAnalysisService,
  ],
  controllers: [
    ExtractionController,
    MatrixAdminController,
    RuleSetReleaseController,
    SectionAnalysisController,
  ],
})
export class ExtractionModule {}
