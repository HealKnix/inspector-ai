import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const [directory, container, reportPath] = process.argv.slice(2);
if (
  !directory ||
  !/^inspector-foundations-clean-engine[-a-z0-9]*$/.test(container ?? "") ||
  !reportPath
)
  throw new Error(
    "Usage: verify-clean-load.mjs BUNDLE_DIRECTORY ISOLATED_ENGINE REPORT_PATH",
  );
function docker(args, stream = false) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    stdio: stream ? "inherit" : "pipe",
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
const inspected = JSON.parse(docker(["inspect", container]))[0];
assert.equal(inspected.HostConfig.NetworkMode, "none");
assert.ok(
  inspected.Mounts.every((mount) => !mount.Source.endsWith("docker.sock")),
);
const engine = JSON.parse(
  docker(["exec", container, "docker", "info", "--format", "{{json .}}"]),
);
assert.equal(engine.Images, 0, "A clean image store is mandatory");
assert.equal(engine.Containers, 0, "A clean engine is mandatory");
const manifest = JSON.parse(
  await readFile(path.join(directory, "manifest.json"), "utf8"),
);
docker(
  [
    "exec",
    container,
    "docker",
    "image",
    "load",
    "--input",
    "/release/images.tar",
  ],
  true,
);
const images = [];
for (const image of manifest.images) {
  const restored = JSON.parse(
    docker(["exec", container, "docker", "image", "inspect", image.reference]),
  )[0];
  assert.equal(restored.Id, image.id, image.reference);
  images.push({
    reference: image.reference,
    expected_id: image.id,
    actual_id: restored.Id,
    matched: true,
  });
}
const report = {
  schema_version: 1,
  checked_at: new Date().toISOString(),
  engine_version: engine.ServerVersion,
  container,
  network_mode: "none",
  starting_images: engine.Images,
  starting_containers: engine.Containers,
  registry_access: false,
  archive_sha256: manifest.files.find((file) => file.path === "images.tar")
    .sha256,
  images,
};
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(
  JSON.stringify({
    clean_load_passed: true,
    images: images.length,
    report: reportPath,
  }),
);
