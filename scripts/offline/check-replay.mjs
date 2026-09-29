import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "./manifest.mjs";

const [directory, project, phase] = process.argv.slice(2);
if (
  !directory ||
  !/^inspector-foundations-[a-z0-9-]+$/.test(project ?? "") ||
  !["before", "after"].includes(phase)
)
  throw new Error(
    "Usage: check-replay.mjs BUNDLE inspector-foundations-PROJECT before|after",
  );
function docker(args) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout;
}
const tables = [
  "users",
  "objects",
  "object_access",
  "processes",
  "runs",
  "files",
  "parse_artifacts",
  "matrix_rows",
  "rule_versions",
  "framework_sets",
];
const fields = tables.map((table) => {
  const identity =
    table === "object_access"
      ? "object_id::text || '/' || user_id::text"
      : "id::text";
  return `'${table}',(SELECT coalesce(json_agg(${identity} ORDER BY ${identity}),'[]'::json) FROM ${table})`;
});
fields.push(
  "'catalog_restore_events',(SELECT count(*) FROM audit_events WHERE action='deployment.catalog.restored')",
);
fields.push(
  "'administrators',(SELECT count(*) FROM users WHERE role='ADMINISTRATOR')",
);
const sql = `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT json_build_object(${fields.join(",")}); COMMIT;`;
const state = JSON.parse(
  docker([
    "exec",
    `${project}-postgres-1`,
    "psql",
    "-X",
    "-qAt",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "postgres",
    "-d",
    "inspector",
    "-c",
    sql,
  ]),
);
const entities = Object.fromEntries(
  tables.map((table) => [
    table,
    {
      count: state[table].length,
      ids_sha256: createHash("sha256")
        .update(JSON.stringify(state[table]))
        .digest("hex"),
    },
  ]),
);
const catalog = JSON.parse(
  docker([
    "exec",
    `${project}-backend-1`,
    "node",
    "backend/scripts/offline-catalog.mjs",
  ]),
);
const stable = {
  manifest_sha256: await sha256(path.join(directory, "manifest.json")),
  catalog_sha256: catalog.content_sha256,
  entities,
  catalog_restore_events: state.catalog_restore_events,
  administrators: state.administrators,
};
assert.equal(
  stable.catalog_restore_events,
  1,
  "Exactly one initial catalog restore event",
);
assert.equal(stable.administrators, 1, "Exactly one bootstrap administrator");
assert.equal(stable.entities.matrix_rows.count, 132);
assert.equal(stable.entities.rule_versions.count, 13);
const report = {
  schema_version: 1,
  project,
  phase,
  captured_at: new Date().toISOString(),
  stable,
  scope:
    "Stable entity identities and exact catalog; auth sessions are intentionally excluded because login creates a new session",
};
// Keep the credential fingerprint local; exported evidence contains only the result.
const secretFingerprintPath = path.join(
  directory,
  `${project}.replay-secret-fingerprint`,
);
const secretFingerprint = await sha256(
  path.join(directory, `${project}.runtime.env`),
);
if (phase === "before") {
  await writeFile(secretFingerprintPath, secretFingerprint, { mode: 0o600 });
}
if (phase === "after") {
  assert.equal(
    secretFingerprint,
    await readFile(secretFingerprintPath, "utf8"),
    "Repeated bootstrap changed the existing runtime secrets",
  );
  report.secret_file_unchanged = true;
  const before = JSON.parse(
    await readFile(
      path.join(directory, `${project}.replay-before.json`),
      "utf8",
    ),
  );
  assert.deepEqual(
    stable,
    before.stable,
    "Repeated bootstrap changed stable entities or catalog",
  );
  report.unchanged = true;
}
await writeFile(
  path.join(directory, `${project}.replay-${phase}.json`),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    phase,
    project,
    counts: Object.fromEntries(
      tables.map((table) => [table, entities[table].count]),
    ),
    unchanged: report.unchanged,
  }),
);
