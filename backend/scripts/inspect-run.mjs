// Ad-hoc run inspection for the real-pipeline exercise. Read-only.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";

const processId = process.argv[2];
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const proc = await prisma.process.findUnique({
  where: { id: processId },
  include: {
    runs: {
      orderBy: { createdAt: "asc" },
      include: {
        inputs: true,
        files: {
          select: { id: true, originalName: true, sha256: true, size: true },
        },
        documentParts: {
          select: {
            id: true,
            fileId: true,
            firstPage: true,
            lastPage: true,
            sourceFingerprint: true,
          },
        },
        parsingTasks: {
          select: {
            id: true,
            state: true,
            fileId: true,
            errorCode: true,
            attempts: true,
          },
        },
        identificationSnapshots: {
          select: {
            id: true,
            version: true,
            resolvedInputHash: true,
            sourceFingerprint: true,
            createdAt: true,
          },
        },
        sectionAnalysisTasks: {
          select: {
            id: true,
            state: true,
            fingerprint: true,
            attempts: true,
            errorCode: true,
            createdAt: true,
            completedAt: true,
          },
        },
      },
    },
  },
});

const extra = {
  parsingTasks: await prisma.parsingTask.findMany({
    where: { processId },
    select: { id: true, state: true, fileId: true, errorCode: true },
  }),
  identificationTasks: await prisma.identificationTask.findMany({
    where: { processId },
    select: { id: true, state: true, runId: true, errorCode: true },
  }),
  documents: await prisma.document.findMany({
    where: { processId },
    select: { id: true, identityKey: true, cardVersion: true },
  }),
  revisions: await prisma.documentRevision.findMany({
    where: { processId },
    select: { id: true, documentId: true, identityKey: true },
  }),
  protocols: await prisma.protocol.findMany({
    where: { processId },
    select: { id: true, runId: true, status: true, createdAt: true },
  }),
  completeness: await prisma.completenessResult.findMany({
    where: { processId },
    select: { id: true, packageVersionId: true },
  }),
  jobs: await prisma.job.findMany({
    where: { processId },
    select: { id: true, runId: true, createdAt: true },
  }),
};

console.log(JSON.stringify({ process: proc, extra }, null, 1));
await prisma.$disconnect();
