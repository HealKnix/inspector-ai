// Read-only snapshot of the explicitly selected local stand. Never invokes approve.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const container = args[args.indexOf("--container") + 1];
const destination = args[args.indexOf("--output") + 1];
if (
  !args.includes("--container") ||
  !args.includes("--output") ||
  !/^[a-z0-9-]+$/.test(container ?? "")
)
  throw new Error(
    "Use --container <explicit-postgres-container> --output <json>",
  );
const query = `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT jsonb_build_object(
 'schema_version', 1, 'captured_at', CURRENT_TIMESTAMP,
 'capture_mode', 'repeatable_read_read_only',
 'imports', (SELECT COALESCE(jsonb_agg(to_jsonb(t) - 'imported_by' ORDER BY id), '[]'::jsonb) FROM matrix_imports t),
 'rows', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY parameter_code), '[]'::jsonb) FROM matrix_rows t),
 'rules', (SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY parameter_code,version,id), '[]'::jsonb) FROM rule_versions t),
 'review_counts', jsonb_build_object('passports', (SELECT count(*) FROM rule_passports), 'reports', (SELECT count(*) FROM rule_regression_reports))
); COMMIT;`;
const output = execFileSync(
  "docker",
  [
    "exec",
    container,
    "psql",
    "-X",
    "-q",
    "-At",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "postgres",
    "-d",
    "inspector",
    "-c",
    query,
  ],
  { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
);
const data = JSON.parse(output.trim());
data.source_stand = {
  container,
  database: "inspector",
  purpose:
    "sealed-offline-r8 runtime snapshot; not the stopped original development database",
};
const bytes = JSON.stringify(data, null, 2) + "\n";
writeFileSync(resolve(destination), bytes, { encoding: "utf8", flag: "wx" });
console.log(
  JSON.stringify({
    path: destination,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    rows: data.rows.length,
    rules: data.rules.length,
    review_counts: data.review_counts,
  }),
);
