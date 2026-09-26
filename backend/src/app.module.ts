import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";

import { RolesGuard } from "./common/guards/roles.guard.js";
import { validateEnvironment } from "./config/environment.js";
import { PrismaModule } from "./infrastructure/prisma/prisma.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { JwtAuthGuard } from "./modules/auth/jwt-auth.guard.js";
import { CompletenessModule } from "./modules/completeness/completeness.module.js";
import { DocumentsAdminModule } from "./modules/documents/documents-admin.module.js";
import { DocumentsModule } from "./modules/documents/documents.module.js";
import { ExtractionModule } from "./modules/extraction/extraction.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { ClassificationModule } from "./modules/identification/classification.module.js";
import { IdentificationModule } from "./modules/identification/identification.module.js";
import { ObjectsModule } from "./modules/objects/objects.module.js";
import { ParsingModule } from "./modules/parsing/parsing.module.js";
import { UsersAdminModule } from "./modules/users/users-admin.module.js";
import { VerificationModule } from "./modules/verification/verification.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    ThrottlerModule.forRoot([{ limit: 120, ttl: 60_000 }]),
    PrismaModule,
    AuthModule,
    HealthModule,
    ObjectsModule,
    DocumentsModule,
    ParsingModule,
    ClassificationModule,
    IdentificationModule,
    ExtractionModule,
    CompletenessModule,
    VerificationModule,
    UsersAdminModule,
    DocumentsAdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
