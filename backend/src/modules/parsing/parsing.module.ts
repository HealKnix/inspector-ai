import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { DocumentsModule } from "../documents/documents.module.js";
import { ObjectsModule } from "../objects/objects.module.js";
import { ArtifactStorageService } from "./artifact-storage.service.js";
import { ParserClientService } from "./parser-client.service.js";
import { ParsingCacheService } from "./parsing-cache.service.js";
import { ParsingJobsService } from "./parsing-jobs.service.js";
import { ParsingController } from "./parsing.controller.js";
import { ParsingService } from "./parsing.service.js";

@Module({
  imports: [ObjectsModule, DocumentsModule],
  providers: [
    ArtifactStorageService,
    ParserClientService,
    ParsingCacheService,
    ParsingJobsService,
    ParsingService,
  ],
  exports: [
    ArtifactStorageService,
    ParserClientService,
    ParsingCacheService,
    ParsingJobsService,
    ParsingService,
  ],
})
export class ParsingCoreModule {}

@Module({
  imports: [AuthModule, ObjectsModule, DocumentsModule, ParsingCoreModule],
  controllers: [ParsingController],
})
export class ParsingModule {}
