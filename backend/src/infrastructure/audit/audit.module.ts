import { Module } from "@nestjs/common";
import { ObjectsModule } from "../../modules/objects/objects.module.js";
import { AuditHistoryController } from "./audit-history.controller.js";
import { AuditHistoryService } from "./audit-history.service.js";

@Module({
  imports: [ObjectsModule],
  controllers: [AuditHistoryController],
  providers: [AuditHistoryService],
})
export class AuditModule {}
