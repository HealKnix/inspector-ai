import { NestFactory } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import "reflect-metadata";
import { AppModule } from "./app.module.js";
import { Role } from "./generated/prisma/enums.js";
import { PrismaService } from "./infrastructure/prisma/prisma.service.js";
import { AuthService } from "./modules/auth/auth.service.js";
import { ObjectAccessService } from "./modules/objects/object-access.service.js";

async function main() {
  const [command, target, value] = process.argv.slice(2);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const prisma = app.get(PrismaService);
  try {
    if (command === "bootstrap" && target) {
      // Deployment-only command, requires direct database credentials. No HTTP surface.
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(17092026)`;
        if (await tx.user.count({ where: { role: "ADMINISTRATOR" } }))
          throw new Error("Администратор уже назначен");
        const user = await tx.user.findUniqueOrThrow({
          where: { login: target.toLowerCase() },
        });
        await tx.user.update({
          where: { id: user.id },
          data: { role: "ADMINISTRATOR" },
        });
        await tx.auditEvent.create({
          data: {
            userId: user.id,
            requestId: randomUUID(),
            action: "deployment.administrator.bootstrap",
            details: { schema_version: 1, source: "trusted_local_deployment" },
          },
        });
      });
    } else {
      const login = process.env.ADMIN_LOGIN;
      const password = process.env.ADMIN_PASSWORD;
      if (!login || !password)
        throw new Error("Требуются ADMIN_LOGIN и ADMIN_PASSWORD");
      const auth = app.get(AuthService);
      const session = await auth.login(login, password);
      try {
        if (session.user.role !== "ADMINISTRATOR")
          throw new Error("Требуется администратор");
        const context = { userId: session.user.id, requestId: randomUUID() };
        if ((command === "grant" || command === "revoke") && target && value) {
          await app
            .get(ObjectAccessService)
            .setAssignment(context, target, value, command === "grant");
        } else if (
          command === "role" &&
          target &&
          (value === Role.INSPECTOR ||
            value === Role.ADMINISTRATOR ||
            value === Role.ML_ENGINEER ||
            value === "none")
        ) {
          await prisma.$transaction(async (tx) => {
            const actor = await tx.user.findUniqueOrThrow({
              where: { id: session.user.id },
            });
            if (actor.role !== "ADMINISTRATOR")
              throw new Error("Требуется администратор");
            const user = await tx.user.findUniqueOrThrow({
              where: { login: target.toLowerCase() },
            });
            await tx.user.update({
              where: { id: user.id },
              data: { role: value === "none" ? null : value },
            });
            await tx.auditEvent.create({
              data: {
                ...context,
                action: "user.role.changed",
                details: {
                  schema_version: 1,
                  target_user_id: user.id,
                  previous: user.role,
                  role: value === "none" ? null : value,
                },
              },
            });
          });
        } else if (command === "retry-outbox" && target) {
          await prisma.$transaction(async (tx) => {
            await tx.outbox.updateMany({
              where: { id: target, deliveredAt: null, attempts: { gte: 20 } },
              data: {
                attempts: 0,
                availableAt: new Date(),
                leaseUntil: null,
                leaseToken: null,
              },
            });
            await tx.auditEvent.create({
              data: {
                ...context,
                action: "outbox.retry",
                details: { event_id: target, schema_version: 1 },
              },
            });
          });
        } else
          throw new Error(
            "Команды: bootstrap <login>; role <login> <INSPECTOR|ADMINISTRATOR|ML_ENGINEER|none>; grant|revoke <object_id> <user_id>; retry-outbox <event_id>",
          );
      } finally {
        await auth.logout(session.refreshToken);
      }
    }
    process.stdout.write("Команда выполнена; аудит сохранён.\n");
  } finally {
    await app.close();
  }
}
void main().catch(() => {
  process.stderr.write(
    "Команда не выполнена. Проверьте аргументы, учётные данные и полномочия.\n",
  );
  process.exitCode = 1;
});
