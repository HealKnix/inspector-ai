import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
const publicPackage =
  "ХАКАТОН_УЧАСТНИКАМ_ГОТОВО_К_ПЕРЕДАЧЕ/02_ФОРМАТ_ДАННЫХ_И_ПРИМЕРЫ";
const archivePackage =
  "02_ЭТАЛОННАЯ_РАЗМЕТКА_И_МЕТОДИКА/hackathon_gold_20260811/УЧАСТНИКАМ_БЕЗ_ОТВЕТОВ";
const annotationPackage = "РАЗМЕЧЕННЫЙ_TRAIN_PUBLIC_203";
const dataNames = [
  "submission_schema.json",
  "split_policy.json",
  "scoring_summary_without_answers.json",
  "document_manifest.jsonl",
  "parameter_catalog_132.jsonl",
  "public_train_checks.jsonl",
  "public_train_finding_groups.jsonl",
];
const jsonLines = (bytes) =>
  bytes
    .toString("utf8")
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
const counts = (rows, key) =>
  Object.fromEntries(
    [...new Set(rows.map((r) => r[key]))]
      .sort()
      .map((v) => [v ?? "null", rows.filter((r) => r[key] === v).length]),
  );

// Fixed public allowlist: no directory traversal, discovery or hidden-answer reads.
export function inventory(materialRoot) {
  const sources = [];
  const read = (relativePath, role) => {
    const bytes = readFileSync(join(materialRoot, relativePath));
    sources.push({
      path: relativePath,
      role,
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
    return bytes;
  };
  const current = Object.fromEntries(
    dataNames.map((name) => [
      name,
      read(
        `${publicPackage}/data/${name}`,
        name.startsWith("public_train")
          ? "public_example_labels_not_inference"
          : "participant_public_contract_or_metadata",
      ),
    ]),
  );
  const archiveMatches = dataNames.map((name) => ({
    name,
    matches_current:
      sha256(
        read(`${archivePackage}/data/${name}`, "archived_participant_public"),
      ) === sha256(current[name]),
  }));
  const declared = read(
    `${publicPackage}/sha256sums_public_package.txt`,
    "public_integrity_manifest",
  ).toString("utf8");
  const checksumChecks = dataNames.map((name) => {
    const line = declared
      .split(/\r?\n/u)
      .find((s) => s.endsWith(`data/${name}`));
    return {
      name,
      match: Boolean(line && line.split(/\s+/u)[0] === sha256(current[name])),
    };
  });
  const manifest = jsonLines(current["document_manifest.jsonl"]);
  const policy = JSON.parse(current["split_policy.json"]);
  const catalog = jsonLines(current["parameter_catalog_132.jsonl"]);
  const examples = jsonLines(current["public_train_checks.jsonl"]);
  const groups = jsonLines(current["public_train_finding_groups.jsonl"]);
  const annotations = jsonLines(
    read(
      `${annotationPackage}/data/files_index.jsonl`,
      "public_annotation_index_not_inference",
    ),
  );
  const publicGold = jsonLines(
    read(
      `${annotationPackage}/data/public_gold_checks.jsonl`,
      "public_example_labels_not_inference",
    ),
  );
  read(
    `${annotationPackage}/data/parameter_catalog_132.jsonl`,
    "public_annotation_catalog",
  );
  read(
    `${annotationPackage}/QA_SUMMARY.json`,
    "supplier_claim_not_independent_verification",
  );
  read(
    `${annotationPackage}/VALIDATION.json`,
    "supplier_claim_not_independent_verification",
  );
  read(
    `${annotationPackage}/SHA256SUMS.jsonl`,
    "public_annotation_integrity_manifest",
  );
  const errors = [];
  const train = new Set(policy.TRAIN_PUBLIC),
    hidden = new Set(policy.TEST_HIDDEN);
  if ([...train].some((id) => hidden.has(id)))
    errors.push("object split overlap");
  if (new Set(manifest.map((r) => r.file_id)).size !== manifest.length)
    errors.push("duplicate file_id");
  for (const row of manifest) {
    const excluded = policy.excluded_file_ids.includes(row.file_id);
    if (
      !excluded &&
      !(
        row.split === "TRAIN_PUBLIC"
          ? train
          : row.split === "TEST_HIDDEN"
            ? hidden
            : new Set()
      ).has(row.object_id)
    )
      errors.push(`unknown object/split ${row.file_id}`);
    if (!/^[a-f0-9]{64}$/u.test(row.sha256))
      errors.push(`bad declared hash ${row.file_id}`);
  }
  for (const row of [...annotations, ...publicGold, ...examples, ...groups])
    if (!train.has(row.object_id) || row.split !== "TRAIN_PUBLIC")
      errors.push("public input contains non-public object");
  const byId = new Map(manifest.map((r) => [r.file_id, r]));
  for (const row of annotations)
    if (
      row.source_sha256 !== byId.get(row.file_id)?.sha256 ||
      row.object_id !== byId.get(row.file_id)?.object_id
    )
      errors.push(`annotation index mismatch ${row.file_id}`);
  const crossSplitHashCollisions = [];
  for (const hash of new Set(manifest.map((r) => r.sha256))) {
    const rows = manifest.filter(
      (r) => r.sha256 === hash && !policy.excluded_file_ids.includes(r.file_id),
    );
    if (new Set(rows.map((r) => r.split)).size > 1)
      crossSplitHashCollisions.push({
        sha256: hash,
        file_ids: rows.map((r) => r.file_id),
      });
  }
  if (crossSplitHashCollisions.length)
    errors.push(
      "identical source content across official splits; quarantine required",
    );
  if (checksumChecks.some((r) => !r.match))
    errors.push("supplier checksum mismatch");
  const report = {
    schema_version: 1,
    scope: "public methodology inventory, not model quality acceptance",
    source_file_hashes_verified: false,
    source_file_hash_note:
      "Original document hashes below are declared by the public manifest; this command independently hashes only allowlisted contract/index/label files. No original PDFs or hidden answers are read.",
    hidden_answers_read: false,
    sources,
    archive_matches_current: archiveMatches,
    public_checksums: checksumChecks,
    manifest: {
      total: manifest.length,
      included: manifest.filter(
        (r) => !policy.excluded_file_ids.includes(r.file_id),
      ).length,
      by_split: counts(manifest, "split"),
      by_object: counts(manifest, "object_id"),
      by_extension: counts(manifest, "extension"),
      cross_split_hash_collisions: crossSplitHashCollisions,
    },
    catalog: {
      rows: catalog.length,
      unique_parameter_codes: new Set(
        catalog.map((r) => r.parameter_code ?? r.code),
      ).size,
    },
    public_examples: {
      atomic_checks: examples.length,
      groups: groups.length,
      objects: counts(examples, "object_id"),
      labels: counts(examples, "violation_label"),
      page_only_evidence: examples
        .flatMap((r) => r.evidence ?? [])
        .every((e) => !e.bbox && !e.polygon),
    },
    annotated_public: {
      files: annotations.length,
      objects: counts(annotations, "object_id"),
      statuses: counts(annotations, "annotation_status"),
      gold_checks: publicGold.length,
      gold_statuses: counts(publicGold, "gold_status"),
      labels: counts(publicGold, "violation_label"),
    },
    errors,
    passed: errors.length === 0,
  };
  const allowedManifest = manifest.map((r) => ({
    file_id: r.file_id,
    object_id: r.object_id,
    split: r.split,
    stage: r.stage,
    section: r.section,
    sha256: r.sha256,
    pdf_pages: r.pdf_pages,
    excluded: policy.excluded_file_ids.includes(r.file_id),
  }));
  return {
    report,
    allowedManifest,
    current,
    parameterCodes: catalog.map((r) => r.parameter_code),
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [root, output] = process.argv.slice(2);
  if (!root || !output)
    throw new Error(
      "Usage: node scripts/acceptance/inventory.mjs <materials-root> <output-directory>",
    );
  const result = inventory(resolve(root));
  mkdirSync(output, { recursive: true });
  for (const [name, value] of Object.entries({
    "input-inventory.json": result.report,
    "permitted-manifest.json": result.allowedManifest,
    "parameter-codes.json": result.parameterCodes,
  }))
    writeFileSync(join(output, name), `${JSON.stringify(value, null, 2)}\n`);
  for (const name of [
    "submission_schema.json",
    "split_policy.json",
    "scoring_summary_without_answers.json",
  ])
    writeFileSync(join(output, name), result.current[name]);
  process.stdout.write(
    `${JSON.stringify({ passed: result.report.passed, manifest: result.report.manifest, catalog: result.report.catalog, examples: result.report.public_examples, annotations: result.report.annotated_public, errors: result.report.errors }, null, 2)}\n`,
  );
  if (!result.report.passed) process.exitCode = 1;
}
