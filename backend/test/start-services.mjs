import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
await mkdir(
  new URL("../../.test-output/storage/quarantine/", import.meta.url),
  { recursive: true },
);
const nginx = await readFile(
  new URL("../../frontend/nginx.conf", import.meta.url),
  "utf8",
);
await writeFile(
  new URL("../../.test-output/upload-proxy.conf", import.meta.url),
  nginx.replaceAll("http://backend:3000", "http://host.docker.internal:3302"),
);
execFileSync(
  "docker",
  [
    "compose",
    "-p",
    "inspector-ingestion-test",
    "-f",
    "compose.ingestion-test.yaml",
    "up",
    "-d",
    "--build",
    "--wait",
    "--wait-timeout",
    "600",
  ],
  { cwd: root, stdio: "inherit" },
);
// Resolve the validator's current container addresses after rebuilds or scaling.
execFileSync(
  "docker",
  [
    "compose",
    "-p",
    "inspector-ingestion-test",
    "-f",
    "compose.ingestion-test.yaml",
    "exec",
    "-T",
    "validator-proxy",
    "nginx",
    "-s",
    "reload",
  ],
  { cwd: root, stdio: "inherit" },
);
