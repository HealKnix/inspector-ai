import { Module } from "@nestjs/common";
import { FileSafetyService } from "../../infrastructure/storage/file-safety.service.js";
import { PrivateStorageService } from "../../infrastructure/storage/private-storage.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { ObjectsModule } from "../objects/objects.module.js";
import { DocumentAdmissionService } from "./document-admission.service.js";
import { DocumentsController } from "./documents.controller.js";

@Module({
  imports: [AuthModule, ObjectsModule],
  controllers: [DocumentsController],
  providers: [
    PrivateStorageService,
    FileSafetyService,
    DocumentAdmissionService,
  ],
  exports: [PrivateStorageService],
})
export class DocumentsModule {}
