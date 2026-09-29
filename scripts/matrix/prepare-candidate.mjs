// Freeze a development candidate beside (never over) the sealed offline bundle.
// Local dependency images and model/signature volumes are reused read-only.
import { createHash, randomBytes } from "node:crypto";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const destination = path.resolve(
  root,
  process.argv[2] ?? ".test-output/matrix-candidate-20260927",
);
if (!destination.startsWith(path.join(root, ".test-output") + path.sep))
  throw new Error("Candidate must be inside .test-output");
const sealed = path.join(root, ".test-output/offline/foundations-20260927-r8");
await readFile(path.join(root, "backend/dist/main.js"));
await readFile(path.join(root, "frontend/dist/index.html"));
await mkdir(destination); // Never replace a prior candidate.
const build = path.join(destination, "build");
await mkdir(build);
await cp(path.join(root, "backend/dist"), path.join(build, "backend-dist"), {
  recursive: true,
});
await cp(path.join(root, "backend/prisma"), path.join(build, "prisma"), {
  recursive: true,
});
await cp(path.join(root, "backend/scripts"), path.join(build, "scripts"), {
  recursive: true,
});
await cp(path.join(root, "frontend/dist"), path.join(build, "frontend-dist"), {
  recursive: true,
});
await cp(
  path.join(root, "backend/document-parser"),
  path.join(build, "parser"),
  {
    recursive: true,
    filter: (source) =>
      !/(?:^|[/\\])(?:__pycache__|\.pytest_cache|tests)(?:[/\\]|$)/.test(
        source,
      ),
  },
);
for (const name of ["catalog.json", "nginx.conf"])
  await cp(path.join(sealed, name), path.join(destination, name));
const compose = JSON.parse(
  await readFile(path.join(sealed, "compose.json"), "utf8"),
);
delete compose.services["asset-restore"];
compose.volumes["parser-models"] = {
  external: true,
  name: "inspector-ai_parser-models",
};
compose.volumes["clamav-data"] = {
  external: true,
  name: "inspector-foundations-r8_clamav-data",
};
const mount = (source, target) => ({
  type: "bind",
  source: `./build/${source}`,
  target,
  read_only: true,
});
for (const [name, service] of Object.entries(compose.services)) {
  if (service.depends_on) delete service.depends_on["asset-restore"];
  if (service.image?.startsWith("inspector-release-backend:")) {
    service.volumes ??= [];
    service.volumes.push(
      mount("backend-dist", "/app/backend/dist"),
      mount("scripts", "/app/backend/scripts"),
    );
  }
  if (name === "migrate")
    service.volumes = [mount("prisma", "/app/backend/prisma")];
  if (name === "parser") service.volumes.push(mount("parser", "/app"));
  if (name === "frontend")
    service.volumes.push(mount("frontend-dist", "/usr/share/nginx/html"));
  if (name === "clamav") {
    service.entrypoint = ["clamd", "--foreground=true"];
    for (const volume of service.volumes) volume.read_only = true;
  }
}
const secret = () => randomBytes(32).toString("hex");
const config = {
  JWT_SECRET: secret(),
  JWT_REFRESH_SECRET: secret(),
  PARSER_TOKEN: secret(),
  METRICS_TOKEN: secret(),
  POSTGRES_USER: "postgres",
  POSTGRES_PASSWORD: secret(),
  POSTGRES_DB: "inspector",
  OFFLINE_PORT: "18081",
  ADMIN_LOGIN: "matrix.admin",
  ADMIN_PASSWORD: secret(),
};
await writeFile(
  path.join(destination, "runtime.env"),
  Object.entries(config)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n",
  { flag: "wx", mode: 0o600 },
);
await writeFile(
  path.join(destination, "compose.json"),
  JSON.stringify(compose, null, 2) + "\n",
);
const files = [];
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const source = path.join(directory, entry.name);
    if (entry.isDirectory()) await scan(source);
    else
      files.push({
        path: path.relative(destination, source).replaceAll("\\", "/"),
        sha256: createHash("sha256")
          .update(await readFile(source))
          .digest("hex"),
      });
  }
}
await scan(build);
await writeFile(
  path.join(destination, "candidate.json"),
  JSON.stringify(
    {
      schema_version: 1,
      kind: "development_candidate_not_acceptance_release",
      created_at: new Date().toISOString(),
      source_catalog: "sealed r8 historical snapshot",
      model_volume_access: "read_only",
      signature_volume_access: "read_only",
      files: files.sort((a, b) => a.path.localeCompare(b.path)),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    candidate: destination,
    port: 18081,
    files: files.length,
    sealed_stand_modified: false,
  }),
);
