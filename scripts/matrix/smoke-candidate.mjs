// Authorized PAR diagnostic copies through the actual admission queue and parser.
// No matrix admission or corpus accuracy is inferred from this smoke.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const directory = path.resolve(process.argv[2]);
if (!process.argv[3])
  throw new Error("Explicit prepared excerpt directory required");
const sourceDirectory = path.resolve(process.argv[3]);
if (!directory.includes(`${path.sep}.test-output${path.sep}matrix-candidate-`))
  throw new Error("Explicit candidate required");
const config = Object.fromEntries(
  (await readFile(path.join(directory, "runtime.env"), "utf8"))
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1)];
    }),
);
const base = `http://127.0.0.1:${config.OFFLINE_PORT}`;
async function request(route, token, body) {
  const response = await fetch(`${base}/api/${route}`, {
    method: body ? "POST" : "GET",
    headers: {
      "content-type": "application/json",
      "x-inspector-request": "1",
      origin: `http://localhost:${config.OFFLINE_PORT}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(180_000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
  return data;
}
const admin = await request("auth/login", null, {
  login: config.ADMIN_LOGIN,
  password: config.ADMIN_PASSWORD,
});
const login = `matrix.probe.${randomUUID().slice(0, 8)}`,
  password = randomBytes(24).toString("base64url");
await request("v1/admin/users", admin.accessToken, {
  login,
  password,
  lastName: "Диагностический",
  firstName: "Стенд",
  role: "INSPECTOR",
});
const session = await request("auth/login", null, { login, password });
const token = session.accessToken;
const object = await request("v1/objects", token, {
  name: "MAT/PAR authorized diagnostic smoke (not 132 acceptance)",
});
const declared = JSON.parse(
  await readFile(path.join(sourceDirectory, "inputs.json"), "utf8"),
);
const sources = [];
for (const input of declared.cases) {
  const name = path.basename(input.source_path);
  const bytes = await readFile(path.join(sourceDirectory, name));
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    input.source_sha256,
  );
  sources.push({
    name,
    bytes,
    source_sha256: input.source_sha256,
    suite: input.suite,
    original_sha256: input.original_sha256,
    original_page_numbers: input.original_page_numbers,
    pages: input.page_numbers.length,
  });
}
const payload = {
  object_id: object.id,
  client_upload_id: randomUUID(),
  files: sources.map((source) => ({
    client_file_id: randomUUID(),
    original_name: source.name,
    content_base64: source.bytes.toString("base64"),
  })),
};
const admitted = await request("v1/documents/upload", token, payload);
assert.equal(admitted.files.length, 3);
assert.ok(admitted.files.every((file) => file.accepted));
const replay = await request("v1/documents/upload", token, payload);
assert.deepEqual(
  replay.files.map((file) => file.file_id),
  admitted.files.map((file) => file.file_id),
);
await writeFile(
  path.join(directory, `smoke-session-${object.id}.json`),
  JSON.stringify({ login, password, object_id: object.id, admitted }),
  { flag: "wx", mode: 0o600 },
);
console.log(
  JSON.stringify({
    stage: "admitted",
    files: 3,
    object_id: object.id,
    replay_identical: true,
  }),
);
let parsed;
for (let n = 0; n < 900; n++) {
  parsed = await request(`v1/objects/${object.id}/parsing`, token);
  if (
    parsed.items.length === 3 &&
    parsed.items.every((item) => ["succeeded", "failed"].includes(item.state))
  )
    break;
  await delay(2000);
}
await writeFile(
  path.join(directory, `smoke-parsing-${object.id}.json`),
  JSON.stringify(parsed, null, 2) + "\n",
);
assert.ok(
  parsed.items.every((item) => item.state === "succeeded"),
  JSON.stringify(
    parsed.items.map((item) => ({ state: item.state, error: item.error_code })),
  ),
);
const artifacts = [];
for (const file of admitted.files) {
  const result = await request(
    `v1/objects/${object.id}/files/${file.file_id}/parse`,
    token,
  );
  const artifact = result.artifact;
  assert.ok(artifact, "parse envelope contains artifact");
  const source = sources.find(
    (source) => source.source_sha256 === artifact.source_sha256,
  );
  assert.ok(source, "artifact belongs to an exact authorized excerpt");
  assert.equal(artifact.pages.length, source.pages);
  artifacts.push({
    file_id: file.file_id,
    source_sha256: artifact.source_sha256,
    pipeline_fingerprint: artifact.pipeline_fingerprint,
    versions: artifact.versions,
    coverage: artifact.coverage,
    native_blocks: artifact.pages
      .flatMap((page) => page.blocks)
      .filter((block) => block.source === "native").length,
    ocr_blocks: artifact.pages
      .flatMap((page) => page.blocks)
      .filter((block) => block.source === "ocr").length,
  });
}
const args = [
  "compose",
  "--env-file",
  path.join(directory, "runtime.env"),
  "-p",
  "inspector-matrix-candidate",
  "-f",
  path.join(directory, "compose.json"),
];
const run = JSON.parse(
  execFileSync(
    "docker",
    [
      ...args,
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "postgres",
      "-d",
      "inspector",
      "-qAt",
      "-c",
      `SELECT jsonb_build_object('run_id',r.id,'release_id',r.rule_set_release_id,'mode',s.manifest->>'mode','rules_hash_matches',(r.input_manifest->'versions'->>'rules')=s.manifest_hash) FROM runs r JOIN rule_set_releases s ON s.id=r.rule_set_release_id WHERE r.object_id='${object.id}'::uuid ORDER BY r.version DESC LIMIT 1`,
    ],
    { encoding: "utf8" },
  ).trim(),
);
assert.equal(run.rules_hash_matches, true);
assert.equal(run.mode, "legacy_capture");
const report = {
  schema_version: 1,
  checked_at: new Date().toISOString(),
  qualification:
    "real admission/queue/native/OCR smoke; not matrix domain acceptance",
  object_id: object.id,
  upload_replay_identical: true,
  originals: sources.map(
    ({
      name,
      source_sha256,
      suite,
      original_sha256,
      original_page_numbers,
    }) => ({
      name,
      source_sha256,
      suite,
      original_sha256,
      original_page_numbers,
    }),
  ),
  artifacts,
  run,
  accepted_matrix_parameters: 0,
};
await writeFile(
  path.join(directory, "runtime-smoke.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    stage: "passed",
    artifact_count: artifacts.length,
    run,
    evidence: path.join(directory, "runtime-smoke.json"),
  }),
);
