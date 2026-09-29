/**
 * Local verification of the three PAR native/OCR regression artifacts.
 * Run from the repository root after installing its locked dependencies:
 * node docs/parsing-regressions/verify-consumers.mjs --results <directory> --report <file.json>
 *
 * Reads existing artifacts; does not run OCR, contact services or modify inputs.
 * The report contains hashes, versions, counts and locator IDs, never document
 * text. The material lookup is a synthetic probe, not an approved matrix rule.
 */
import { Ajv } from "ajv";
import assert from "node:assert/strict";
import console from "node:console";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual, parseArgs } from "node:util";
import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const artifactNames = [
  "gi-base-p1.artifact.json",
  "gi-rev3-p1.artifact.json",
  "public-f0152-p8-p9.artifact.json",
];

async function main() {
  const { values } = parseArgs({
    options: {
      results: { type: "string" },
      report: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help || !values.results || !values.report) {
    console.log(
      "Usage: node docs/parsing-regressions/verify-consumers.mjs --results <directory> --report <file.json>",
    );
    if (!values.help) process.exitCode = 2;
    return;
  }
  const resultsDirectory = resolve(values.results);
  const reportPath = resolve(values.report);
  assert(
    !artifactNames.some(
      (name) => resolve(resultsDirectory, name) === reportPath,
    ),
    "Report must not overwrite an input artifact",
  );

  // Compile the actual workspace TypeScript modules into a separate temporary
  // directory. This avoids stale dist files and does not change the workspace.
  const cacheDirectory = await mkdtemp(
    join(tmpdir(), "inspector-par-consumers-"),
  );
  const cache = new Map();
  async function compiled(file) {
    file = resolve(root, file);
    if (cache.has(file)) return cache.get(file);
    const target = join(cacheDirectory, sha256(file) + ".mjs");
    cache.set(file, pathToFileURL(target).href);
    let output = ts.transpileModule(await readFile(file, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
      },
    }).outputText;
    for (const match of [...output.matchAll(/from\s+["']([^"']+)["']/g)]) {
      const specifier = match[1];
      if (specifier.startsWith("node:")) continue;
      const replacement = specifier.startsWith(".")
        ? await compiled(
            resolve(dirname(file), specifier.replace(/\.js$/, ".ts")),
          )
        : pathToFileURL(require.resolve(specifier)).href;
      output = output
        .replaceAll(`"${specifier}"`, JSON.stringify(replacement))
        .replaceAll(`'${specifier}'`, JSON.stringify(replacement));
    }
    await writeFile(target, output);
    return cache.get(file);
  }
  const { validateArtifact } = await import(
    await compiled("backend/src/modules/parsing/parsing-contract.ts")
  );
  const { analysisBlocks } = await import(
    await compiled("backend/src/modules/parsing/analysis-blocks.ts")
  );
  const { findAnchorHits, contextWindows, pageTables } = await import(
    await compiled("backend/src/modules/extraction/block-search.ts")
  );
  const { executePlan } = await import(
    await compiled("backend/src/modules/extraction/extraction-engine.ts")
  );
  const { buildClassificationContext } = await import(
    await compiled(
      "backend/src/modules/identification/classification-context.ts",
    )
  );
  const { parseArtifactSchema } = await import(
    await compiled("frontend/src/api/types/parsing.ts")
  );
  const { parseArtifactSchema: openapiSchema } = await import(
    await compiled("backend/src/modules/parsing/parsing-openapi.ts")
  );
  const validateOpenapi = new Ajv({
    strict: false,
    validateFormats: false,
  }).compile(openapiSchema);
  const report = {
    created_at: new Date().toISOString(),
    source_versions: {},
    artifacts: [],
  };
  for (const name of artifactNames) {
    const file = join(resultsDirectory, name);
    const raw = await readFile(file);
    const artifact = JSON.parse(raw);
    const before = JSON.stringify(artifact);
    const result = {
      file: basename(file),
      sha256: sha256(raw),
      source_sha256: artifact.source_sha256,
      pipeline_fingerprint: artifact.pipeline_fingerprint,
      versions: artifact.versions,
    };
    try {
      assert(
        validateArtifact(
          artifact,
          artifact.source_sha256,
          artifact.pipeline_fingerprint,
        ) === artifact,
      );
      assert(isDeepStrictEqual(parseArtifactSchema.parse(artifact), artifact));
      assert(validateOpenapi(artifact));
      assert(JSON.stringify(artifact) === before);
      result.contracts = "PASS";
      result.contract_validators = [
        "backend-strict",
        "frontend-zod",
        "openapi-ajv",
      ];
    } catch {
      // Assertion/Zod error bodies may contain input text. Never serialize them.
      result.contracts = "FAIL";
      result.error = "contract_validation_failed";
      report.artifacts.push(result);
      continue;
    }
    const eligible = artifact.pages.flatMap(analysisBlocks);
    const skipped = artifact.pages.flatMap((page) =>
      page.blocks.filter(
        (block) =>
          block.native_valid === true &&
          block.provenance?.status !== "ambiguous" &&
          !block.provenance?.reasons.includes("DUPLICATE_NATIVE_READING") &&
          page.regions?.find((region) => region.id === block.region_id)
            ?.method === "skipped",
      ),
    );
    const terms = skipped
      .map((block) => (block.normalized_text || block.raw_text).trim())
      .filter(Boolean);
    const hits = findAnchorHits(artifact, terms);
    assert(
      skipped.every(
        (block) =>
          eligible.includes(block) &&
          (!block.raw_text.trim() || hits.some((hit) => hit.block === block)),
      ),
    );
    result.skipped_valid_native_count = skipped.length;
    result.skipped_native_locator_ids = skipped.map((block) => block.id);
    result.locators_unchanged = true;
    result.eligible_count = eligible.length;
    result.id_context_fragments =
      buildClassificationContext(artifact).fragments.length;
    result.table_count = artifact.pages.flatMap(pageTables).length;
    result.associated_labels = eligible.filter(
      (block) =>
        block.kind === "text" && block.table_link?.status === "associated",
    ).length;
    const labels = eligible.filter((block) => /пенопл/i.test(block.raw_text));
    result.material_label_count = labels.length;
    if (labels.length) {
      const plan = {
        kind: "table_lookup",
        signature: { any: ["пенопл"] },
        row: { anchors: ["пенопл"] },
        value: { type: "number", unit: ["м³", "м3"] },
      };
      const outcome = executePlan(artifact, plan, {
        parameter_code: "SYNTHETIC-PROBE",
        rule_version_id: "00000000-0000-4000-8000-000000000001",
        version: 1,
        plan,
        comparison: null,
      });
      result.material_probe = {
        status: outcome.status,
        value: outcome.value,
        unit: outcome.unit,
        locator_ids: outcome.evidence.map((item) => item.block_id),
      };
      result.material_context = contextWindows(artifact, ["пенопл"]).map(
        (window) => ({
          table_id: window.table_id,
          locators: window.lines.map((line) => line.block_id),
          contains_50: window.lines.some((line) => /\b50\b/.test(line.text)),
        }),
      );
    }
    if (name === "gi-rev3-p1.artifact.json")
      assert(result.skipped_valid_native_count === 46);
    if (name === "gi-base-p1.artifact.json") {
      assert(
        isDeepStrictEqual(
          [
            result.material_probe.status,
            result.material_probe.value,
            result.material_probe.unit,
          ],
          ["extracted", 50, "m3"],
        ),
      );
      assert(
        result.material_context.some(
          (window) =>
            window.table_id &&
            window.contains_50 &&
            labels.some((label) => window.locators.includes(label.id)),
        ),
      );
    }
    assert(JSON.stringify(artifact) === before);
    report.artifacts.push(result);
  }
  for (const file of cache.keys())
    report.source_versions[relative(root, file).replaceAll("\\", "/")] = sha256(
      await readFile(file),
    );
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify(
      report.artifacts.map((result) => {
        const summary = { ...result };
        delete summary.skipped_native_locator_ids;
        return summary;
      }),
      null,
      2,
    ),
  );
  if (report.artifacts.some((result) => result.contracts !== "PASS"))
    process.exitCode = 1;
}

try {
  await main();
} catch {
  console.error(
    "Consumer verification failed; input text was withheld from diagnostics.",
  );
  process.exitCode = 1;
}
