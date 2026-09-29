import { createHash } from "node:crypto";
import type { Prisma } from "../../generated/prisma/client.js";
import { canonicalJson } from "../documents/canonical-json.js";
import { IDENTIFICATION_ENGINE_VERSION } from "./identification-contract.js";

export const IDENTIFICATION_POLICY_VERSIONS = {
  identification: IDENTIFICATION_ENGINE_VERSION,
  merge: "sheet-document-grouping-v2",
  selection: "explicit-sheet-period-selection-v2",
} as const;

export function identificationHash(value: unknown) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function identificationJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** Only latest attempts belonging to this exact Run may become its sources. */
export async function identificationSources(
  tx: Prisma.TransactionClient,
  runId: string,
) {
  const run = await tx.run.findUniqueOrThrow({
    where: { id: runId },
    include: {
      process: true,
      inputs: { include: { file: true }, orderBy: { fileId: "asc" } },
    },
  });
  const attempts = await tx.parsingTask.findMany({
    where: { runId },
    orderBy: { cycle: "desc" },
    include: {
      artifact: {
        include: { classifications: { orderBy: { cycle: "desc" }, take: 1 } },
      },
    },
  });
  const sources = run.inputs.map(({ file }) => {
    const parsing = attempts.find((task) => task.fileId === file.id) ?? null;
    const artifact = parsing?.artifact ?? null;
    return {
      file,
      parsing,
      artifact,
      classification: artifact?.classifications[0] ?? null,
    };
  });
  const decisions = await tx.clarification.findMany({
    where: { processId: run.processId },
    orderBy: [{ cardVersion: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  const ready =
    sources.length > 0 &&
    sources.every(
      ({ file, parsing, artifact, classification }) =>
        Boolean(file.corruptedAt) ||
        (parsing &&
          ["succeeded", "failed"].includes(parsing.state) &&
          (parsing.state === "failed" ||
            Boolean(
              artifact &&
              artifact.sourceSha256 === file.sha256 &&
              classification &&
              ["succeeded", "failed"].includes(classification.state),
            ))),
    );
  const fingerprint = identificationHash({
    policy_versions: IDENTIFICATION_POLICY_VERSIONS,
    run: run.id,
    inputs: sources.map(({ file, parsing, artifact, classification }) => ({
      file: file.id,
      hash: file.sha256,
      corrupted: file.corruptedAt?.toISOString() ?? null,
      parsing: parsing ? [parsing.id, parsing.state] : null,
      artifact: artifact
        ? [artifact.id, artifact.artifactSha256, artifact.pipelineFingerprint]
        : null,
      classification: classification
        ? [
            classification.id,
            classification.state,
            classification.fingerprint,
            classification.result,
          ]
        : null,
    })),
    decisions: decisions.map((decision) => decision.id),
  });
  return { run, sources, decisions, ready, fingerprint };
}

export async function identificationBusy(
  tx: Prisma.TransactionClient,
  runId: string,
) {
  const states = ["queued", "processing"];
  const parsing = await tx.parsingTask.count({
    where: { runId, state: { in: states } },
  });
  const classification = await tx.classificationTask.count({
    where: { artifact: { task: { runId } }, state: { in: states } },
  });
  const extraction = await tx.extractionTask.count({
    where: { artifact: { task: { runId } }, state: { in: states } },
  });
  const identification = await tx.identificationTask.count({
    where: { runId, state: { in: states } },
  });
  return Boolean(parsing || classification || extraction || identification);
}

export type IdentificationSources = Awaited<
  ReturnType<typeof identificationSources>
>;
