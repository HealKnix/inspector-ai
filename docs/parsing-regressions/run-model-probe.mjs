/** Run from the repository root after prepare_runtime_inputs.py. */
import { spawn } from "node:child_process";
import console from "node:console";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const runName = process.argv[2];
if (!runName || !/^[a-z0-9-]+$/.test(runName))
  throw new Error(
    "Supply a fresh output directory name: node docs/parsing-regressions/run-model-probe.mjs <run-name>",
  );
const source = JSON.parse(
  (
    await readFile(".test-output/par-native-ocr-20260927-inputs.json", "utf8")
  ).replace(/^\uFEFF/, ""),
);
const suites = new Map([
  ["authorised-diagnostic-regression", "authorized-diagnostic"],
  ["public-train-raster-regression", "TRAIN_PUBLIC_PROBE"],
]);
if (
  source.schema_version !== 1 ||
  source.hidden_files_read !== 0 ||
  source.sources.length !== 3
)
  throw new Error("Expected the three declared regression sources");
const cases = source.sources.map((item) => {
  const id = item.id.toLowerCase();
  if (!/^[a-z0-9-]+$/.test(id) || !suites.has(item.suite))
    throw new Error("Undeclared source identifier or suite");
  return {
    id,
    suite: suites.get(item.suite),
    source_path: `/inputs/${id}.pdf`,
    source_sha256: item.source_sha256,
    page_numbers: item.page_numbers,
  };
});
if (new Set(cases.map((item) => item.id)).size !== cases.length)
  throw new Error("Duplicate source identifier");
const output = path.resolve(".test-output", runName);
// Refuse to overwrite a prior run or its artifacts.
await mkdir(output);
const copies = path.join(output, "original-copies");
await mkdir(copies);
const digest = async (file) =>
  createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
for (const [index, item] of source.sources.entries()) {
  if ((await digest(item.source_path)) !== item.source_sha256)
    throw new Error("Original hash mismatch");
  const target = path.join(copies, `${cases[index].id}.pdf`);
  await copyFile(item.source_path, target);
  if ((await digest(target)) !== item.source_sha256)
    throw new Error("Copy hash mismatch");
}
await writeFile(
  path.join(output, "inputs.json"),
  JSON.stringify({ schema_version: 1, cases }, null, 2) + "\n",
);
const image = "inspector-release-parser:foundations-20260927-r6";
const args = [
  "run",
  "--rm",
  "--name",
  `inspector-par-probe-${process.pid}`,
  "--network",
  "none",
  "--cpus",
  "2",
  "--memory",
  "3g",
  "--cap-drop",
  "ALL",
  "--security-opt",
  "no-new-privileges:true",
  "--mount",
  `type=bind,source=${path.join(root, "backend/document-parser")},target=/app,readonly`,
  "--mount",
  `type=bind,source=${output},target=/work`,
  "--mount",
  "type=volume,source=inspector-ai_parser-models,target=/models,readonly",
  "--mount",
  `type=bind,source=${copies},target=/inputs,readonly`,
  image,
  "python",
  "experiments/native_ocr_probe.py",
  "--manifest",
  "/work/inputs.json",
  "--output",
  "/work/results",
];
console.log(
  JSON.stringify({
    image,
    network: "none",
    cases: cases.map((item) => item.id),
    output,
  }),
);
const child = spawn("docker", args, { stdio: "inherit" });
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", async (code) => {
  try {
    for (const item of source.sources)
      if ((await digest(item.source_path)) !== item.source_sha256)
        throw new Error("Original changed");
    console.log(
      JSON.stringify({
        originals_unchanged: true,
        declared_sources: source.sources.length,
      }),
    );
    process.exitCode = code ?? 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
});
