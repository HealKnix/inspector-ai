import { readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import process from "node:process";
import { sha256 } from "./inventory.mjs";

const [materials, output] = process.argv.slice(2);
if (!materials || !output)
  throw new Error(
    "Usage: node scripts/acceptance/verify-public-files.mjs <materials-root> <report.json>",
  );
const root = resolve(
  materials,
  "ХАКАТОН_УЧАСТНИКАМ_ГОТОВО_К_ПЕРЕДАЧЕ/01_ДОКУМЕНТАЦИЯ",
);
const data = resolve(
  materials,
  "ХАКАТОН_УЧАСТНИКАМ_ГОТОВО_К_ПЕРЕДАЧЕ/02_ФОРМАТ_ДАННЫХ_И_ПРИМЕРЫ/data",
);
const policy = JSON.parse(
  readFileSync(resolve(data, "split_policy.json"), "utf8"),
);
const manifestBytes = readFileSync(resolve(data, "document_manifest.jsonl"));
const rows = manifestBytes
  .toString("utf8")
  .split(/\r?\n/u)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const files = [];
for (const row of rows) {
  if (row.split !== "TRAIN_PUBLIC") continue; // Never open hidden source files or answers.
  if (
    !policy.TRAIN_PUBLIC.includes(row.object_id) ||
    policy.TEST_HIDDEN.includes(row.object_id)
  )
    throw new Error("Unsafe public object split");
  let result;
  try {
    const path = realpathSync(resolve(root, row.relative_path));
    const local = relative(realpathSync(root), path);
    if (local.startsWith("..") || isAbsolute(local))
      throw new Error("Source escapes corpus root");
    const bytes = statSync(path).size;
    const hash = sha256(readFileSync(path));
    result = {
      file_id: row.file_id,
      object_id: row.object_id,
      bytes,
      sha256: hash,
      matched: bytes === row.size_bytes && hash === row.sha256,
    };
  } catch (error) {
    result = {
      file_id: row.file_id,
      object_id: row.object_id,
      matched: false,
      error_code: error.code ?? "UNSAFE_PATH",
    };
  }
  files.push(result);
}
const report = {
  schema_version: 1,
  method:
    "independent SHA-256 over original TRAIN_PUBLIC bytes, no document extraction",
  manifest_sha256: sha256(manifestBytes),
  hidden_files_read: 0,
  total: files.length,
  verified: files.filter((f) => f.matched).length,
  bytes: files.reduce((n, f) => n + (f.bytes ?? 0), 0),
  passed: files.length === 203 && files.every((f) => f.matched),
  files,
};
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ...report, files: undefined })}\n`);
if (!report.passed) process.exitCode = 1;
