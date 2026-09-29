import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { sha256 } from "./inventory.mjs";

// Reuse the declared backend dev dependency; no new package or downloader.
const require = createRequire(
  new URL("../../backend/package.json", import.meta.url),
);
const Ajv2020 = require("ajv/dist/2020.js").default;
const contracts = new URL("../../docs/acceptance/contracts/", import.meta.url);
const schemaBytes = readFileSync(new URL("submission_schema.json", contracts));
export const schemaHash =
  "75c58bef6b580528e7e4af8e4fdcdf5a5d40599b8966dae90df38b3a5f04a8d7";
if (sha256(schemaBytes) !== schemaHash)
  throw new Error(
    "External submission schema changed: review contract/version before validation",
  );
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(
  JSON.parse(schemaBytes),
);
const knownManifest = JSON.parse(
  readFileSync(new URL("permitted-manifest.json", contracts), "utf8"),
);
const knownCodes = JSON.parse(
  readFileSync(new URL("parameter-codes.json", contracts), "utf8"),
);

export function validateSubmission(
  submission,
  { manifest = knownManifest, codes = knownCodes } = {},
) {
  const schemaValid = validate(submission);
  const schemaErrors = globalThis.structuredClone(validate.errors ?? []);
  const errors = [];
  if (schemaValid) {
    const files = new Map(manifest.map((r) => [r.file_id, r]));
    const points = new Set();
    if (
      !manifest.some((r) => r.object_id === submission.object_id && !r.excluded)
    )
      errors.push("unknown_object_id");
    if (!submission.checks.length)
      errors.push("empty_checks_not_quality_acceptance");
    for (const [index, check] of submission.checks.entries()) {
      const problem = (reason) => errors.push(`checks[${index}]:${reason}`);
      if (!codes.includes(check.parameter_code))
        problem("unknown_parameter_code");
      if (!check.location.trim()) problem("empty_atomic_location");
      const key = JSON.stringify([check.parameter_code, check.location]);
      if (points.has(key)) problem("duplicate_atomic_location");
      points.add(key);
      if (
        ["VIOLATION_PRESENT", "NO_VIOLATION"].includes(check.violation_label) &&
        !check.evidence.length
      )
        problem("missing_evidence_for_definite_conclusion");
      for (const evidence of check.evidence) {
        const file = files.get(evidence.file_id);
        if (!file || file.excluded) {
          problem("unknown_or_excluded_file");
          continue;
        }
        if (file.object_id !== submission.object_id)
          problem("file_object_mismatch");
        if (file.stage !== evidence.stage) problem("file_stage_mismatch");
        if (!Number.isInteger(file.pdf_pages) || file.pdf_pages < 1)
          problem("page_count_not_confirmed_for_source");
        else if (evidence.pdf_page_number > file.pdf_pages)
          problem("page_out_of_range");
      }
    }
  }
  return {
    schema_sha256: schemaHash,
    schema_valid: schemaValid,
    schema_errors: schemaErrors,
    semantic_valid: schemaValid && !errors.length,
    semantic_errors: errors,
    full_evidence_group_quality_verified: false,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const path = process.argv[2];
  if (!path)
    throw new Error(
      "Usage: node scripts/acceptance/submission.mjs <submission.json>",
    );
  const report = validateSubmission(JSON.parse(readFileSync(path, "utf8")));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.semantic_valid) process.exitCode = 1;
}
