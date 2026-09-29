// Deployment-only restore of an exact historical snapshot, never a rule approval API.
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";

const tables = [
  "matrix_imports",
  "matrix_rows",
  "rule_versions",
  "rule_passports",
  "rule_regression_reports",
  "framework_sets",
  "framework_vocabularies",
  "framework_requirements",
  "framework_section_mappings",
];
const filters = {
  rule_versions: " WHERE status = 'approved'",
  rule_passports:
    " WHERE rule_version_id IN (SELECT id FROM rule_versions WHERE status = 'approved')",
  rule_regression_reports:
    " WHERE rule_version_id IN (SELECT id FROM rule_versions WHERE status = 'approved')",
  framework_sets: " WHERE status = 'approved'",
  framework_vocabularies:
    " WHERE set_id IN (SELECT id FROM framework_sets WHERE status = 'approved')",
  framework_requirements:
    " WHERE set_id IN (SELECT id FROM framework_sets WHERE status = 'approved')",
  framework_section_mappings:
    " WHERE set_id IN (SELECT id FROM framework_sets WHERE status = 'approved')",
};
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical(value[k])]),
    );
  return value;
}
function digest(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const restore = process.argv.includes("--restore");
  await client.query(
    restore ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
  );
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  if (restore) await client.query("SELECT pg_advisory_xact_lock(27092026)");
  const current = {};
  for (const table of tables) {
    // Older installations predate the additive review gate. Preserve that absence explicitly.
    if (
      !restore &&
      ["rule_passports", "rule_regression_reports"].includes(table) &&
      !(await client.query("SELECT to_regclass($1) AS name", [table])).rows[0]
        .name
    ) {
      current[table] = [];
      continue;
    }
    const result = await client.query(
      `SELECT to_jsonb(t) AS row FROM ${table} t${filters[table] ?? ""} ORDER BY id`,
    );
    current[table] = result.rows.map((r) => r.row);
  }
  if (!restore) {
    if (current.rule_passports.length || current.rule_regression_reports.length)
      throw new Error(
        "Reviewed catalogs require an approved portable-fixture export policy; initial bundle only carries the historical catalog",
      );
    const manifest = {
      schema_version: 1,
      kind: "historical_catalog_snapshot",
      captured_at: new Date().toISOString(),
      capture_mode: "repeatable_read_read_only",
      tables: current,
      content_sha256: digest(current),
      qualification:
        "Existing approvals only; this snapshot is not a new corpus validation or MAT full release.",
    };
    await client.query("COMMIT");
    process.stdout.write(JSON.stringify(manifest, null, 2) + "\n");
  } else {
    if (
      process.env.OFFLINE_BOOTSTRAP !== "1" ||
      !/^[a-f0-9]{64}$/.test(process.env.CATALOG_SNAPSHOT_SHA256 ?? "")
    )
      throw new Error(
        "Restore requires an explicit deployment profile and pinned snapshot hash",
      );
    const bytes = await readFile(
      process.env.CATALOG_SNAPSHOT_PATH ?? "/release/catalog.json",
    );
    if (
      createHash("sha256").update(bytes).digest("hex") !==
      process.env.CATALOG_SNAPSHOT_SHA256
    )
      throw new Error("Catalog file hash mismatch");
    const snapshot = JSON.parse(bytes.toString("utf8"));
    if (
      snapshot.schema_version !== 1 ||
      snapshot.kind !== "historical_catalog_snapshot" ||
      Object.keys(snapshot.tables ?? {})
        .sort()
        .join() !== [...tables].sort().join() ||
      snapshot.content_sha256 !== digest(snapshot.tables)
    )
      throw new Error("Invalid snapshot");
    const actor = (
      await client.query("SELECT id, role FROM users WHERE login = $1", [
        process.env.ADMIN_LOGIN,
      ])
    ).rows[0];
    if (actor?.role !== "ADMINISTRATOR")
      throw new Error("Existing deployment administrator required");
    // Fresh installation is mandatory. A repeat may only confirm byte-equivalent content.
    if (tables.some((t) => current[t].length)) {
      if (digest(current) !== snapshot.content_sha256)
        throw new Error("Refusing to overwrite an existing catalog");
      await client.query("COMMIT");
      process.stdout.write(
        JSON.stringify({
          restored: false,
          identical: true,
          content_sha256: snapshot.content_sha256,
        }) + "\n",
      );
    } else {
      for (const table of tables) {
        if (
          Number(
            (await client.query(`SELECT count(*) FROM ${table}`)).rows[0].count,
          ) !== 0
        )
          throw new Error(
            "Refusing historical restore into non-empty catalog tables",
          );
      }
      const objects = Number(
        (await client.query("SELECT count(*) FROM objects")).rows[0].count,
      );
      if (objects !== 0)
        throw new Error(
          "Historical restore is limited to an empty installation",
        );
      for (const table of tables) {
        const rows = snapshot.tables[table];
        if (!Array.isArray(rows)) throw new Error("Invalid rows");
        const columns = (
          await client.query(
            "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
            [table],
          )
        ).rows.map((r) => r.column_name);
        for (const row of rows) {
          if (Object.keys(row).sort().join() !== [...columns].sort().join())
            throw new Error(`Incompatible schema: ${table}`);
        }
        await client.query(
          `INSERT INTO ${table} SELECT * FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)`,
          [JSON.stringify(rows)],
        );
      }
      await client.query(
        "INSERT INTO audit_events (id,user_id,request_id,action,details) VALUES ($1,$2,$3,$4,$5::jsonb)",
        [
          randomUUID(),
          actor.id,
          randomUUID(),
          "deployment.catalog.restored",
          JSON.stringify({
            schema_version: 1,
            source: "historical_snapshot",
            snapshot_sha256: snapshot.content_sha256,
            original_approvals_preserved: true,
          }),
        ],
      );
      await client.query("COMMIT");
      process.stdout.write(
        JSON.stringify({
          restored: true,
          content_sha256: snapshot.content_sha256,
          matrix_rows: snapshot.tables.matrix_rows.length,
          approved_versions: snapshot.tables.rule_versions.length,
          parameters: new Set(
            snapshot.tables.rule_versions.map((r) => r.parameter_code),
          ).size,
        }) + "\n",
      );
    }
  }
} catch (error) {
  await client.query("ROLLBACK");
  process.stderr.write(
    `Catalog operation failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
} finally {
  await client.end();
}
