// Read the existing candidate smoke object; no upload, approval or clarification.
import assert from "node:assert/strict";
import console from "node:console";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
const directory = path.resolve(process.argv[2] ?? "");
const objectId = process.argv[3];
const outputName = process.argv[4] ?? "identification-api-probe.json";
if (!/^[a-z0-9-]+\.json$/.test(outputName))
  throw new Error("Report file name required");
const expectedEngine = "sheet-document-identification-v4";
if (
  !directory.includes(`${path.sep}.test-output${path.sep}matrix-candidate-`) ||
  !/^[a-f0-9-]{36}$/.test(objectId ?? "")
)
  throw new Error("Explicit candidate smoke required");
const config = Object.fromEntries(
  (await readFile(path.join(directory, "runtime.env"), "utf8"))
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1)];
    }),
);
const saved = JSON.parse(
  await readFile(
    path.join(directory, `smoke-session-${objectId}.json`),
    "utf8",
  ),
);
assert.equal(saved.object_id, objectId);
const base = `http://127.0.0.1:${config.OFFLINE_PORT}/api`;
async function request(route, token, body) {
  const res = await fetch(base + route, {
    method: body ? "POST" : "GET",
    headers: {
      "content-type": "application/json",
      "x-inspector-request": "1",
      origin: `http://localhost:${config.OFFLINE_PORT}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Probe HTTP ${res.status}`);
  return res.json();
}
const session = await request("/auth/login", null, {
  login: saved.login,
  password: saved.password,
});
let registry, revision;
for (let attempt = 0; attempt < 30; attempt++) {
  registry = await request(
    `/v1/processes/${saved.admitted.process_id}/documents`,
    session.accessToken,
  );
  revision = registry.documents
    .flatMap((d) => d.revisions)
    .find((r) =>
      r.candidates.some((c) => c.field === "observed_replaced_sheet"),
    );
  if (revision) break;
  await delay(1500);
}
assert(revision, "No current revision candidates returned by live worker/API");
assert.equal(registry.run_id, saved.admitted.run_id);
const candidates = revision.candidates.filter((c) =>
  ["revision_label", "observed_replaced_sheet", "number"].includes(c.field),
);
assert(candidates.every((c) => c.engine_version === expectedEngine));
assert.deepEqual(
  candidates
    .filter((c) => c.field === "observed_replaced_sheet")
    .map((c) => c.raw)
    .sort(),
  ["1", "4", "8"],
);
assert.equal(candidates.find((c) => c.field === "revision_label")?.raw, "3");
assert.equal(revision.fields.revision_label, undefined);
assert.equal(revision.fields.observed_replaced_sheet, undefined);
assert.equal(revision.approval.confirmed, false);
assert(revision.blockers.includes("unsupported_partial_replacement"));
assert(
  candidates.every((c) =>
    c.evidence.every((e) => e.parse_context?.native_valid === true),
  ),
);
const report = {
  schema_version: 1,
  checked_at: new Date().toISOString(),
  qualification:
    "existing authorised diagnostic object, real worker/PostgreSQL/read API; no approval or sheet selection",
  object_id: objectId,
  run_id: registry.run_id,
  resolved_input_hash: registry.resolved_input_hash,
  snapshot_count: registry.snapshot_versions.length,
  engine: expectedEngine,
  candidates: candidates.map((c) => ({
    field: c.field,
    raw: c.raw,
    evidence: c.evidence.map((e) => ({
      file_id: e.file_id,
      artifact_id: e.artifact_id,
      artifact_sha256: e.artifact_sha256,
      source_sha256: e.source_sha256,
      page_number: e.page_number,
      block_id: e.block_id,
      bbox: e.bbox,
      parse_context: e.parse_context,
    })),
  })),
  accepted_revision: false,
  selected_sheets: false,
  passed: true,
};
const output = path.join(directory, outputName);
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    passed: true,
    candidates: candidates.length,
    snapshots: report.snapshot_count,
    report: output,
  }),
);
