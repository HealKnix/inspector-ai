// Compact pipeline status for our run (and in-flight work) — read-only.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";

const PROCESS = "7b089092-3575-4514-afe1-07b0734bc57e";
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const files = await prisma.file.findMany({
  where: { processId: PROCESS },
  select: { id: true, originalName: true },
});
const name = Object.fromEntries(
  files.map((f) => [f.id, f.originalName.slice(0, 32)]),
);

console.log("== pipeline activity");
const busy = await prisma.parsingTask.findMany({
  where: { state: { in: ["processing", "queued"] } },
  select: {
    state: true,
    processId: true,
    fileId: true,
    phase: true,
    pagesCompleted: true,
    pagesTotal: true,
    errorCode: true,
  },
  orderBy: { createdAt: "asc" },
});
for (const t of busy)
  console.log(
    t.state.padEnd(11),
    (t.phase ?? "-").padEnd(17),
    `${t.pagesCompleted}/${t.pagesTotal ?? "?"}`,
    t.errorCode ?? "",
    name[t.fileId] ?? t.fileId.slice(0, 8),
    t.processId.slice(0, 8),
  );

console.log("== run tasks");
const parsed = await prisma.parsingTask.findMany({
  where: { processId: PROCESS },
  select: {
    fileId: true,
    state: true,
    errorCode: true,
    artifact: {
      select: {
        id: true,
        classifications: { select: { state: true, errorCode: true } },
      },
    },
  },
});
console.log(
  "parsing:",
  JSON.stringify(
    parsed.map((t) => ({
      file: name[t.fileId] ?? t.fileId.slice(0, 8),
      state: t.state,
      err: t.errorCode,
      cls: t.artifact?.classifications ?? [],
    })),
  ),
);
const cls = [];
const idn = await prisma.identificationTask.findMany({
  where: { processId: PROCESS },
  select: { state: true, errorCode: true },
});
const snap = await prisma.resolvedInputSnapshot.findMany({
  where: { processId: PROCESS },
  select: { version: true, resolvedInputHash: true },
});
const sec = await prisma.sectionAnalysisTask.findMany({
  where: { processId: PROCESS },
  select: { state: true, attempts: true, errorCode: true },
});
console.log("classification:", JSON.stringify(cls));
console.log("identification:", JSON.stringify(idn));
console.log("snapshots:", JSON.stringify(snap));
console.log("section:", JSON.stringify(sec));
await prisma.$disconnect();
