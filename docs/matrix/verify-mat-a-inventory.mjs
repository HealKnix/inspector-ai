import { log } from "node:console";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import process from "node:process";
import { URL } from "node:url";

const root = new URL("../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root));
const sha = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : value && typeof value === "object"
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(",")}}`
      : JSON.stringify(value);
const manifest = JSON.parse(
  read("docs/matrix/mat-a-legacy-manifest-2026-09-27.json"),
);
const bytes = read(manifest.inventory_path);
const inventory = JSON.parse(bytes);
const failures = [];
const check = (condition, reason) => {
  if (!condition) failures.push(reason);
};
check(
  sha(canonical(inventory)) === manifest.inventory_canonical_sha256,
  "inventory canonical hash",
);
for (const source of manifest.sources) {
  const actual = read(source.path);
  const byteMatch = sha(actual) === source.sha256;
  const lfMatch =
    source.normalized_lf_sha256 &&
    sha(actual.toString("utf8").replaceAll("\r\n", "\n")) ===
      source.normalized_lf_sha256;
  check(byteMatch || lfMatch, `source hash: ${source.path}`);
}
const codes = Array.from(
  { length: 132 },
  (_, index) => `P${String(index + 1).padStart(3, "0")}`,
);
check(
  JSON.stringify(
    [...new Set(inventory.rows.map((row) => row.parameter_code))].sort(),
  ) === JSON.stringify(codes),
  "P001–P132 code set",
);
const catalog = read("backend/scripts/matrix-132.jsonl")
  .toString("utf8")
  .split(/\r?\n/)
  .filter(Boolean)
  .map(JSON.parse);
for (const row of inventory.rows)
  check(
    canonical(row.raw) ===
      canonical(
        catalog.find((item) => item.parameter_code === row.parameter_code),
      ),
    `raw row: ${row.parameter_code}`,
  );
const catalogSource = manifest.sources.find((source) =>
  source.path.endsWith(".jsonl"),
);
const matrixSource = manifest.sources.find((source) =>
  source.path.endsWith(".xlsx"),
);
for (const imported of inventory.imports) {
  check(
    imported.source_sha256 === catalogSource.normalized_lf_sha256 ||
      imported.source_sha256 === catalogSource.sha256,
    `import catalog: ${imported.id}`,
  );
  check(
    imported.origin_sha256 === matrixSource.sha256,
    `import origin: ${imported.id}`,
  );
}
const approved = inventory.rules.filter((rule) => rule.status === "approved");
check(
  approved.length === manifest.approved_record_count &&
    approved.length === manifest.approved_versions.length,
  "approved record count",
);
for (const version of manifest.approved_versions) {
  const rule = approved.find((item) => item.id === version.id);
  check(
    rule && sha(canonical(rule)) === version.rule_sha256,
    `rule hash: ${version.id}`,
  );
  if (rule) {
    check(
      sha(canonical(rule.plan)) === version.plan_sha256,
      `plan hash: ${version.id}`,
    );
    check(
      sha(canonical(rule.comparison)) === version.comparison_sha256,
      `comparison hash: ${version.id}`,
    );
  }
}
log(
  JSON.stringify(
    {
      rows: inventory.rows.length,
      unique_codes: codes.length,
      versions: inventory.rules.length,
      approved_records: approved.length,
      effective_parameters: new Set(approved.map((rule) => rule.parameter_code))
        .size,
      capture_byte_hash_matches: sha(bytes) === manifest.inventory_sha256,
      canonical_hash_matches:
        sha(canonical(inventory)) === manifest.inventory_canonical_sha256,
      failures,
    },
    null,
    2,
  ),
);
if (failures.length) process.exitCode = 1;
