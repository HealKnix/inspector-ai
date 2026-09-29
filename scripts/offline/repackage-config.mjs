// Create a new immutable configuration revision without copying deployment secrets.
import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { sha256, validateOfflineCompose, verifyBundle } from "./manifest.mjs";

const [baseDirectory, destination, release, composeFile] =
  process.argv.slice(2);
if (
  !baseDirectory ||
  !destination ||
  !/^[a-z][a-z0-9-]{1,60}$/.test(release ?? "") ||
  !composeFile
)
  throw new Error(
    "Usage: repackage-config.mjs BASE_BUNDLE NEW_DIRECTORY RELEASE COMPOSE_JSON",
  );
const base = path.resolve(baseDirectory),
  output = path.resolve(destination);
assert.notEqual(base, output, "A configuration revision needs a new directory");
const original = await verifyBundle(base);
const compose = validateOfflineCompose(
  JSON.parse(await readFile(composeFile, "utf8")),
);
assert.deepEqual(
  [
    ...new Set(Object.values(compose.services).map((service) => service.image)),
  ].sort(),
  original.manifest.images.map((image) => image.reference).sort(),
  "A configuration revision must preserve the exact image set",
);
await mkdir(output, { recursive: true });
assert.equal((await readdir(output)).length, 0, "Destination must be empty");
for (const file of original.manifest.files) {
  const target = path.join(output, file.path);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(base, file.path), target);
}
await writeFile(
  path.join(output, "compose.json"),
  JSON.stringify(compose, null, 2) + "\n",
);
// Ship the current installer/validator and operator instructions with the revision.
for (const name of ["manifest.mjs", "bootstrap.mjs"])
  await copyFile(
    new URL(`./${name}`, import.meta.url),
    path.join(output, "tools", name),
  );
await writeFile(
  path.join(output, "README.md"),
  (
    await readFile(
      new URL("../../docs/offline-release.md", import.meta.url),
      "utf8",
    )
  ).replace(/\[([^\]]+)\]\((?!https?:)[^)]*\)/g, "$1 (в исходном репозитории)"),
);
const files = [];
for (const file of original.manifest.files) {
  const target = path.join(output, file.path);
  files.push({
    path: file.path,
    bytes: (await stat(target)).size,
    sha256: await sha256(target),
  });
}
const manifest = {
  ...original.manifest,
  release,
  created_at: new Date().toISOString(),
  configuration_revision_of: original.manifestSha256,
  files,
};
await writeFile(
  path.join(output, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
const verified = await verifyBundle(output);
console.log(
  JSON.stringify({
    bundle: output,
    manifest_sha256: verified.manifestSha256,
    base_manifest_sha256: original.manifestSha256,
    images_unchanged: true,
  }),
);
