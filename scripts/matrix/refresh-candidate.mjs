// Append a build snapshot to an existing development candidate. Never rewrite
// its first build, credentials, data volumes, or the sealed foundations stand.
import console from "node:console";
import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = path.resolve(root, process.argv[2] ?? "");
if (!directory.startsWith(path.join(root, ".test-output", "matrix-candidate-")))
  throw new Error("Explicit development candidate required");
const initial = JSON.parse(
  await readFile(path.join(directory, "candidate.json"), "utf8"),
);
if (initial.kind !== "development_candidate_not_acceptance_release")
  throw new Error("Wrong candidate kind");
const revision = `revision-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
const destination = path.join(directory, revision);
await mkdir(destination);
for (const [source, target] of [
  ["backend/dist", "backend-dist"],
  ["frontend/dist", "frontend-dist"],
  ["backend/prisma", "prisma"],
])
  await cp(path.join(root, source), path.join(destination, target), {
    recursive: true,
  });
const compose = JSON.parse(
  await readFile(path.join(directory, "compose.json"), "utf8"),
);
for (const service of Object.values(compose.services))
  for (const volume of service.volumes ?? [])
    if (
      [
        "/app/backend/dist",
        "/usr/share/nginx/html",
        "/app/backend/prisma",
      ].includes(volume.target)
    )
      volume.source = `./${revision}/${volume.target.endsWith("prisma") ? "prisma" : volume.target.endsWith("dist") ? "backend-dist" : "frontend-dist"}`;
const files = [];
async function scan(current) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const location = path.join(current, entry.name);
    if (entry.isDirectory()) await scan(location);
    else
      files.push({
        path: path.relative(destination, location).replaceAll("\\", "/"),
        sha256: createHash("sha256")
          .update(await readFile(location))
          .digest("hex"),
      });
  }
}
await scan(destination);
await writeFile(
  path.join(destination, "manifest.json"),
  JSON.stringify(
    {
      schema_version: 1,
      created_at: new Date().toISOString(),
      previous_candidate: initial.created_at,
      qualification: "development build; not matrix domain acceptance",
      files,
    },
    null,
    2,
  ) + "\n",
);
const serialized = JSON.stringify(compose, null, 2) + "\n";
await writeFile(path.join(directory, `compose.${revision}.json`), serialized, {
  flag: "wx",
});
try {
  const previous = await readFile(
    path.join(directory, "compose.current.json"),
    "utf8",
  );
  await writeFile(
    path.join(directory, `compose.before-${revision}.json`),
    previous,
    { flag: "wx" },
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await writeFile(path.join(directory, "compose.current.json"), serialized);
console.log(
  JSON.stringify({
    revision,
    files: files.length,
    compose: path.join(directory, "compose.current.json"),
    original_build_preserved: true,
  }),
);
