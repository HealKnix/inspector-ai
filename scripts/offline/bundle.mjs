import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256, validateOfflineCompose, verifyBundle } from "./manifest.mjs";
import { resourceInventory } from "./resource-inventory.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
function docker(args, options = {}) {
  const run = spawnSync("docker", args, {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (run.status !== 0)
    throw new Error(
      `Docker ${args[0]} failed: ${(run.stderr ?? "").slice(-3000)}`,
    );
  return run.stdout;
}
const [
  mode,
  destination,
  release = "foundations-20260927",
  sourceProject = "inspector-ai",
  catalogBundle,
] = process.argv.slice(2);
if (!destination || !["build", "verify", "load"].includes(mode))
  throw new Error(
    "Usage: bundle.mjs build|verify|load DIRECTORY [release-tag] [source-project] [verified-catalog-bundle]",
  );
if (
  !/^[a-z][a-z0-9-]{1,60}$/.test(release) ||
  !/^[a-z][a-z0-9-]{1,60}$/.test(sourceProject)
)
  throw new Error("Invalid release/project name");
const output = path.resolve(destination);
if (mode !== "build") {
  const result = await verifyBundle(output);
  validateOfflineCompose(
    JSON.parse(await readFile(path.join(output, "compose.json"), "utf8")),
  );
  if (mode === "load") {
    docker(["image", "load", "--input", path.join(output, "images.tar")], {
      stdio: "inherit",
    });
    for (const image of result.manifest.images) {
      const actual = JSON.parse(
        docker(["image", "inspect", image.reference]),
      )[0];
      if (actual.Id !== image.id)
        throw new Error(`Loaded image differs: ${image.reference}`);
    }
  }
  console.log(
    JSON.stringify({
      verified: true,
      loaded: mode === "load",
      manifest_sha256: result.manifestSha256,
    }),
  );
  process.exit(0);
}
await mkdir(output, { recursive: true });
if ((await readdir(output)).length)
  throw new Error(
    "Build destination must be empty; use a new release directory",
  );
await mkdir(path.join(output, "assets"));
await mkdir(path.join(output, "tools"));
for (const file of [
  "manifest.mjs",
  "bootstrap.mjs",
  "restore-assets.py",
  "snapshot-assets.py",
])
  await copyFile(
    path.join(repo, "scripts/offline", file),
    path.join(output, "tools", file),
  );
await copyFile(
  path.join(repo, "backend/scripts/offline-catalog.mjs"),
  path.join(output, "tools/offline-catalog.mjs"),
);
await writeFile(
  path.join(output, "README.md"),
  (await readFile(path.join(repo, "docs/offline-release.md"), "utf8")).replace(
    /\[([^\]]+)\]\((?!https?:)[^)]*\)/g,
    "$1 (в исходном репозитории)",
  ),
);

const imageFor = {
  backend: `inspector-release-backend:${release}`,
  migrate: `inspector-release-migrate:${release}`,
  frontend: `inspector-release-frontend:${release}`,
  parser: `inspector-release-parser:${release}`,
  validator: `inspector-release-validator:${release}`,
  clamav: `inspector-release-clamav:${release}`,
};
const builds = [
  ["backend", "backend/Dockerfile", "node-runtime"],
  ["migrate", "backend/Dockerfile", "node-migrate"],
  ["frontend", "frontend/Dockerfile", "offline-runtime"],
  ["parser", "backend/document-parser/Dockerfile", null],
  ["validator", "backend/file-validator/Dockerfile", null],
  ["clamav", "backend/antivirus/Dockerfile", null],
];
for (const [name, file, target] of builds) {
  const args = [
    "build",
    "--platform",
    "linux/amd64",
    "--file",
    file,
    "--tag",
    imageFor[name],
  ];
  if (target) args.push("--target", target);
  if (name === "frontend") args.push("--build-arg", "VITE_API_URL=/api");
  console.log(`Building ${name}`);
  docker([...args, "."], { stdio: "inherit" });
  if (name === "backend") {
    docker(
      [
        "run",
        "--rm",
        "--network",
        "none",
        "--workdir",
        "/app/backend",
        "--env",
        "DATABASE_URL=postgresql://synthetic:synthetic@unreachable:5432/synthetic",
        "--env",
        "JWT_SECRET=synthetic-build-import-probe-secret-0001",
        "--env",
        "JWT_REFRESH_SECRET=synthetic-build-import-probe-secret-0002",
        "--env",
        "CLASSIFICATION_LLM_ENABLED=false",
        "--entrypoint",
        "node",
        imageFor.backend,
        "--input-type=module",
        "-e",
        "await import('reflect-metadata'); await import('./dist/app.module.js'); console.log('Production module imports verified')",
      ],
      { stdio: "inherit" },
    );
  }
  if (name === "migrate") {
    docker(
      [
        "run",
        "--rm",
        "--network",
        "none",
        "--env",
        "DATABASE_URL=postgresql://synthetic:synthetic@unreachable:5432/synthetic",
        "--entrypoint",
        "node",
        imageFor.migrate,
        "/app/backend/node_modules/prisma/build/index.js",
        "--help",
      ],
      { stdio: "inherit" },
    );
  }
}

const raw = JSON.parse(
  docker([
    "compose",
    "--env-file",
    "scripts/offline/empty.env",
    "-f",
    "compose.yaml",
    "config",
    "--no-interpolate",
    "--no-env-resolution",
    "--format",
    "json",
  ]),
);
delete raw.name;
for (const key of Object.keys(raw)) if (key.startsWith("x-")) delete raw[key];
delete raw.services["parser-models"];
raw.networks = {
  offline: { internal: true },
  ingress: { driver: "bridge", internal: false },
};
for (const [name, service] of Object.entries(raw.services)) {
  delete service.build;
  delete service.ports;
  delete service.profiles;
  delete service.container_name;
  service.image =
    imageFor[name] ??
    (name.endsWith("worker") ? imageFor.backend : service.image);
  service.pull_policy = "never";
  service.networks = ["offline"];
  if (service.command?.[0] === "bun") service.command[0] = "node";
  if (service.healthcheck?.test?.[1] === "bun")
    service.healthcheck.test[1] = "node";
  if (
    [
      "backend",
      "worker",
      "parsing-worker",
      "classification-worker",
      "extraction-worker",
    ].includes(name)
  ) {
    service.environment.METRICS_TOKEN = "${METRICS_TOKEN:?required}";
    service.environment.OBS_SERVICE_NAME = name;
  }
  if (service.environment?.CLASSIFICATION_LLM_ENABLED !== undefined) {
    service.environment.CLASSIFICATION_LLM_ENABLED = "false";
    service.environment.CLASSIFICATION_LLM_BASE_URL =
      "http://model-runtime:8000/v1";
    service.environment.CLASSIFICATION_LLM_API_KEY = "";
  }
}
for (const volume of Object.values(raw.volumes)) delete volume.name;
raw.volumes["document-quarantine"] = {}; // Its /data ownership is inherited from the release image.
raw.services.frontend.networks = ["offline", "ingress"];
raw.services.frontend.dns = ["127.0.0.1"];
raw.services.frontend.cap_add = ["NET_ADMIN"];
raw.services.frontend.cap_drop = ["NET_RAW"];
raw.services.frontend.security_opt = ["no-new-privileges:true"];
raw.services.frontend.entrypoint = ["/usr/local/bin/offline-entrypoint.sh"];
raw.services.frontend.command = ["nginx", "-g", "daemon off;"];
raw.services.frontend.healthcheck = {
  test: [
    "CMD",
    "wget",
    "-T",
    "3",
    "-q",
    "-O",
    "/dev/null",
    "http://127.0.0.1/",
  ],
  interval: "5s",
  timeout: "4s",
  retries: 10,
  start_period: "10s",
};
raw.services.frontend.ports = [
  {
    target: 80,
    published: "${OFFLINE_PORT:-18080}",
    host_ip: "127.0.0.1",
    protocol: "tcp",
  },
];
raw.services.backend.environment.FRONTEND_URL =
  "http://localhost:${OFFLINE_PORT:-18080}";
const nginx = (
  await readFile(path.join(repo, "frontend/nginx.conf"), "utf8")
).replace(
  "    location /api/ {",
  "    location ^~ /api/internal/ { return 404; }\n\n    location /api/ {",
);
await writeFile(path.join(output, "nginx.conf"), nginx);
raw.services.frontend.volumes = [
  {
    type: "bind",
    source: "./nginx.conf",
    target: "/etc/nginx/conf.d/default.conf",
    read_only: true,
  },
];
raw.services.clamav.environment = { CLAMAV_NO_FRESHCLAMD: "true" };
raw.services["asset-restore"] = {
  image: imageFor.parser,
  pull_policy: "never",
  networks: ["offline"],
  user: "0:0",
  entrypoint: ["python", "/release/tools/restore-assets.py"],
  restart: "no",
  volumes: [
    "./assets:/release/assets:ro",
    "./tools:/release/tools:ro",
    "parser-models:/models",
    "clamav-data:/clamav",
  ],
};
for (const service of [raw.services.parser, raw.services.clamav]) {
  service.depends_on ??= {};
  service.depends_on["asset-restore"] = {
    condition: "service_completed_successfully",
    required: true,
  };
}
validateOfflineCompose(raw);
await writeFile(
  path.join(output, "compose.json"),
  JSON.stringify(raw, null, 2) + "\n",
);

// Only model/signature volumes are read; no document, database, credential or user volume is copied.
for (const [name, volume] of [
  ["models", "parser-models"],
  ["clamav", "clamav-data"],
]) {
  console.log(
    docker([
      "run",
      "--rm",
      "--network",
      "none",
      "--user",
      "0:0",
      "--entrypoint",
      "python",
      "--mount",
      `type=volume,source=${sourceProject}_${volume},target=/source,readonly`,
      "--mount",
      `type=bind,source=${path.join(output, "assets")},target=/out`,
      "--mount",
      `type=bind,source=${path.join(output, "tools")},target=/tools,readonly`,
      imageFor.parser,
      "/tools/snapshot-assets.py",
      name,
    ]).trim(),
  );
}
const catalogScript = await readFile(
  path.join(repo, "backend/scripts/offline-catalog.mjs"),
  "utf8",
);
let catalog;
if (catalogBundle) {
  await verifyBundle(path.resolve(catalogBundle));
  catalog = await readFile(
    path.join(path.resolve(catalogBundle), "catalog.json"),
    "utf8",
  );
} else
  catalog = docker(
    [
      "exec",
      "-i",
      "--workdir",
      "/app/backend",
      `${sourceProject}-backend-1`,
      "bun",
      "-",
    ],
    { input: catalogScript },
  );
JSON.parse(catalog);
await writeFile(path.join(output, "catalog.json"), catalog);
await writeFile(
  path.join(output, "resources.json"),
  JSON.stringify(
    await resourceInventory(repo, output, imageFor, docker),
    null,
    2,
  ) + "\n",
);
const refs = [...new Set(Object.values(raw.services).map((s) => s.image))];
const images = refs.map((reference) => {
  const info = JSON.parse(docker(["image", "inspect", reference]))[0];
  return {
    reference,
    id: info.Id,
    repo_digests: info.RepoDigests ?? [],
    bytes: info.Size,
    platform: `${info.Os}/${info.Architecture}`,
  };
});
docker(
  ["image", "save", "--output", path.join(output, "images.tar"), ...refs],
  { stdio: "inherit" },
);
async function filesBelow(directory, prefix = "") {
  const list = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name,
      full = path.join(directory, entry.name);
    if (entry.isDirectory())
      list.push(...(await filesBelow(full, relative + "/")));
    else
      list.push({
        path: relative,
        bytes: (await stat(full)).size,
        sha256: await sha256(full),
      });
  }
  return list.sort((a, b) => a.path.localeCompare(b.path));
}
const manifest = {
  schema_version: 1,
  release,
  scope: "OFF-initial",
  created_at: new Date().toISOString(),
  runtime: {
    backend: "node-24.16.0",
    package_manager: "bun-1.4.2",
    parser: "existing-cpu-profile",
    gpu_acceptance: false,
  },
  qualification:
    "Initial implemented core; not a full 132-rule, H100 or final H/F acceptance.",
  images,
  files: await filesBelow(output),
};
await writeFile(
  path.join(output, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
const result = await verifyBundle(output);
console.log(
  JSON.stringify({
    bundle: output,
    manifest_sha256: result.manifestSha256,
    image_count: images.length,
  }),
);
