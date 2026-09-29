import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256, validateOfflineCompose, verifyBundle } from "./manifest.mjs";

const directory = path.resolve(
  process.argv[2] ?? fileURLToPath(new URL("../", import.meta.url)),
);
const project = process.argv[3] ?? "inspector-offline";
const port = Number(process.argv[4] ?? 18080);
if (
  !/^inspector-[a-z0-9-]{3,60}$/.test(project) ||
  !Number.isInteger(port) ||
  port < 1024 ||
  port > 65535
)
  throw new Error(
    "Usage: bootstrap.mjs BUNDLE_DIRECTORY inspector-PROJECT [PORT]",
  );
const { manifest, manifestSha256 } = await verifyBundle(directory);
validateOfflineCompose(
  JSON.parse(await readFile(path.join(directory, "compose.json"), "utf8")),
);
function docker(args, inherited = false) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    cwd: directory,
    stdio: inherited ? "inherit" : "pipe",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(
      `Docker ${args[0]} failed: ${(result.stderr ?? "").slice(-2000)}`,
    );
  return result.stdout;
}
const runtimePath = path.join(directory, `${project}.runtime.env`);
let config;
try {
  config = Object.fromEntries(
    (await readFile(runtimePath, "utf8"))
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const split = line.indexOf("=");
        return [line.slice(0, split), line.slice(split + 1)];
      }),
  );
  if (Number(config.OFFLINE_PORT) !== port)
    throw new Error("Existing instance has a different port");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  const secret = () => randomBytes(36).toString("base64url");
  config = {
    JWT_SECRET: secret(),
    JWT_REFRESH_SECRET: secret(),
    PARSER_TOKEN: secret(),
    METRICS_TOKEN: secret(),
    POSTGRES_USER: "postgres",
    POSTGRES_PASSWORD: secret(),
    POSTGRES_DB: "inspector",
    OFFLINE_PORT: String(port),
    ADMIN_LOGIN: "release.admin",
    ADMIN_PASSWORD: secret(),
  };
  await writeFile(
    runtimePath,
    Object.entries(config)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
    { mode: 0o600, flag: "wx" },
  );
}
await chmod(runtimePath, 0o600);
const existingImages = spawnSync(
  "docker",
  ["image", "inspect", ...manifest.images.map((image) => image.reference)],
  {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 16 * 1024 * 1024,
  },
);
const existing =
  existingImages.status === 0 ? JSON.parse(existingImages.stdout) : [];
const imagesAlreadyExact =
  existing.length === manifest.images.length &&
  existing.every((image, index) => image.Id === manifest.images[index].id);
if (!imagesAlreadyExact)
  docker(
    ["image", "load", "--input", path.join(directory, "images.tar")],
    true,
  );
for (const image of manifest.images) {
  if (
    JSON.parse(docker(["image", "inspect", image.reference]))[0].Id !== image.id
  )
    throw new Error("Image identity differs after load");
}
const compose = [
  "compose",
  "--project-name",
  project,
  "--env-file",
  runtimePath,
  "-f",
  path.join(directory, "compose.json"),
];
docker([...compose, "up", "-d", "--wait", "--wait-timeout", "600"], true);
const url = `http://127.0.0.1:${port}`;
async function auth(endpoint, body) {
  const response = await fetch(`${url}/api/auth/${endpoint}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-inspector-request": "1",
      origin: `http://localhost:${port}`,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}
const credentials = {
  login: config.ADMIN_LOGIN,
  password: config.ADMIN_PASSWORD,
};
let session = await auth("login", credentials);
if (session.status === 401) {
  const registered = await auth("register", {
    ...credentials,
    lastName: "Развёртывание",
    firstName: "Администратор",
  });
  if (registered.status !== 201)
    throw new Error(`Administrator registration failed: ${registered.status}`);
  session = await auth("login", credentials);
}
if (session.status !== 201 && session.status !== 200)
  throw new Error(`Administrator login failed: ${session.status}`);
// Registration uses the current INSPECTOR default. The deployment CLI itself
// rejects promotion once any administrator exists, including during recovery.
if (session.data.user.role === null || session.data.user.role === "INSPECTOR") {
  docker(
    [
      ...compose,
      "exec",
      "-T",
      "backend",
      "node",
      "backend/dist/admin.js",
      "bootstrap",
      config.ADMIN_LOGIN,
    ],
    true,
  );
} else if (session.data.user.role !== "ADMINISTRATOR")
  throw new Error(
    "Bootstrap account has an unexpected role; no role replacement performed",
  );
const catalogHash = await sha256(path.join(directory, "catalog.json"));
docker(
  [
    ...compose,
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
  ],
  true,
);
// Check the restored source catalog through the same read-only exporter, not a count-only test.
const restored = JSON.parse(
  docker([
    ...compose,
    "exec",
    "-T",
    "backend",
    "node",
    "backend/scripts/offline-catalog.mjs",
  ]),
);
const original = JSON.parse(
  await readFile(path.join(directory, "catalog.json"), "utf8"),
);
if (restored.content_sha256 !== original.content_sha256)
  throw new Error("Restored catalog content differs");
const report = {
  schema_version: 1,
  project,
  port,
  manifest_sha256: manifestSha256,
  catalog_sha256: restored.content_sha256,
  installed_at: new Date().toISOString(),
  matrix_rows: restored.tables.matrix_rows.length,
  approved_versions: restored.tables.rule_versions.length,
  approved_parameters: new Set(
    restored.tables.rule_versions.map((r) => r.parameter_code),
  ).size,
  core_networks_internal: true,
  frontend_ingress: "loopback; fail-closed OUTPUT guard; no external DNS",
  runtime: manifest.runtime,
  image_restore: imagesAlreadyExact
    ? "already_present_exact_ids"
    : "loaded_from_archive",
  scope:
    "OFF-initial; cold startup and exact catalog restore, functional smoke recorded separately",
};
await writeFile(
  path.join(directory, `${project}.installation.json`),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    installed: true,
    url,
    report: `${project}.installation.json`,
    credentials_file: runtimePath,
  }),
);
