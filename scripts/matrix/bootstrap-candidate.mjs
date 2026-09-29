// Only the isolated candidate. No output includes credentials or tokens.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const directory = path.resolve(process.argv[2]);
if (!directory.includes(`${path.sep}.test-output${path.sep}matrix-candidate-`))
  throw new Error("Explicit matrix candidate directory required");
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
async function request(route, body, token) {
  const response = await fetch(`${base}/api/${route}`, {
    method: body ? "POST" : "GET",
    headers: {
      "content-type": "application/json",
      "x-inspector-request": "1",
      origin: `http://localhost:${config.OFFLINE_PORT}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, data: await response.json() };
}
const credentials = {
  login: config.ADMIN_LOGIN,
  password: config.ADMIN_PASSWORD,
};
let login = await request("auth/login", credentials);
if (login.status === 401) {
  const registration = await request("auth/register", {
    ...credentials,
    lastName: "Тестовый",
    firstName: "Администратор",
  });
  if (registration.status !== 201)
    throw new Error(`Registration: ${registration.status}`);
  login = await request("auth/login", credentials);
}
if (![200, 201].includes(login.status))
  throw new Error(`Login: ${login.status}`);
const args = [
  "compose",
  "--env-file",
  path.join(directory, "runtime.env"),
  "-p",
  "inspector-matrix-candidate",
  "-f",
  path.join(directory, "compose.json"),
];
const docker = (command) =>
  execFileSync("docker", command, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
if (login.data.user.role !== "ADMINISTRATOR")
  docker([
    ...args,
    "exec",
    "-T",
    "backend",
    "node",
    "backend/dist/admin.js",
    "bootstrap",
    config.ADMIN_LOGIN,
  ]);
const catalogHash = createHash("sha256")
  .update(await readFile(path.join(directory, "catalog.json")))
  .digest("hex");
const restored = JSON.parse(
  docker([
    ...args,
    "run",
    "--rm",
    "--no-deps",
    "--volume",
    `${directory}:/release:ro`,
    "--env",
    "OFFLINE_BOOTSTRAP=1",
    "--env",
    `CATALOG_SNAPSHOT_SHA256=${catalogHash}`,
    "--env",
    `ADMIN_LOGIN=${config.ADMIN_LOGIN}`,
    "backend",
    "node",
    "backend/scripts/offline-catalog.mjs",
    "--restore",
  ]),
);
login = await request("auth/login", credentials);
const rows = await request(
  "v1/admin/matrix/rows",
  null,
  login.data.accessToken,
);
const releases = await request(
  "v1/admin/matrix/releases",
  null,
  login.data.accessToken,
);
const contract = await request(
  "v1/admin/matrix/review-contract",
  null,
  login.data.accessToken,
);
if (
  rows.status !== 200 ||
  rows.data.items.length !== 132 ||
  releases.status !== 200 ||
  contract.status !== 200
)
  throw new Error("Candidate admin API check failed");
const report = {
  schema_version: 1,
  kind: "candidate_bootstrap_not_full_acceptance",
  checked_at: new Date().toISOString(),
  matrix_rows: rows.data.items.length,
  restored,
  release_api: releases.status,
  active_release_id: releases.data.active_release_id,
  engines: contract.data.engines,
  original_stand_modified: false,
  production_rules_approved_by_this_script: 0,
};
await writeFile(
  path.join(directory, "bootstrap-check.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report));
