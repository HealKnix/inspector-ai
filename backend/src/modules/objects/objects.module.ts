import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { ObjectAccessService } from "./object-access.service.js";
import { ObjectsController } from "./objects.controller.js";
import { ObjectsService } from "./objects.service.js";

@Module({
  imports: [AuthModule],
  controllers: [ObjectsController],
  providers: [ObjectsService, ObjectAccessService],
  exports: [ObjectAccessService],
})
export class ObjectsModule {}
