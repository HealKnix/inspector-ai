import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

export async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export function relativeAsset(value) {
  if (
    typeof value !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(value) ||
    value
      .split("/")
      .some((part) => part === ".." || part === "." || part === "")
  ) {
    throw new Error("Invalid bundle asset path");
  }
  return value;
}

export async function verifyBundle(directory) {
  const root = await realpath(directory);
  const manifestPath = path.join(root, "manifest.json");
  if ((await lstat(manifestPath)).isSymbolicLink())
    throw new Error("Symlink manifest");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (
    manifest.schema_version !== 1 ||
    !Array.isArray(manifest.files) ||
    !manifest.files.length ||
    !Array.isArray(manifest.images) ||
    !manifest.images.length
  )
    throw new Error("Invalid manifest");
  const seen = new Set();
  for (const item of manifest.files) {
    relativeAsset(item.path);
    if (
      seen.has(item.path) ||
      !/^[a-f0-9]{64}$/.test(item.sha256) ||
      !Number.isSafeInteger(item.bytes) ||
      item.bytes < 0
    )
      throw new Error("Invalid asset metadata");
    seen.add(item.path);
    const file = path.join(root, item.path);
    const actual = await realpath(file);
    const relative = path.relative(root, actual);
    const info = await lstat(file);
    if (
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      info.isSymbolicLink() ||
      !info.isFile() ||
      info.size !== item.bytes ||
      (await sha256(file)) !== item.sha256
    ) {
      throw new Error(`Asset verification failed: ${item.path}`);
    }
  }
  for (const required of [
    "images.tar",
    "compose.json",
    "catalog.json",
    "assets/models.tar",
    "assets/clamav.tar",
    "tools/restore-assets.py",
  ]) {
    if (!seen.has(required))
      throw new Error(`Missing required asset: ${required}`);
  }
  for (const image of manifest.images) {
    if (
      typeof image.reference !== "string" ||
      !/^[a-z0-9][a-z0-9._/:-]+$/.test(image.reference) ||
      !/^sha256:[a-f0-9]{64}$/.test(image.id)
    )
      throw new Error("Invalid image metadata");
  }
  return { manifest, manifestSha256: await sha256(manifestPath) };
}

export function validateOfflineCompose(config) {
  if (
    !config.services ||
    !config.networks ||
    Object.values(config.networks).some((n) => n.external) ||
    Object.entries(config.networks).some(
      ([name, n]) =>
        n.internal !== true &&
        !(
          name === "ingress" &&
          n.driver === "bridge" &&
          n.internal === false &&
          !n.external
        ),
    )
  ) {
    throw new Error(
      "Only the guarded frontend ingress may use a non-internal bridge",
    );
  }
  for (const [name, service] of Object.entries(config.services)) {
    if (
      service.build ||
      service.pull_policy !== "never" ||
      service.network_mode ||
      !service.image
    ) {
      throw new Error(`Runtime build/pull or network escape: ${name}`);
    }
    const networks = Array.isArray(service.networks)
      ? service.networks
      : Object.keys(service.networks ?? {});
    if (
      !networks.length ||
      networks.some(
        (n) =>
          !config.networks[n] ||
          (!config.networks[n]?.internal &&
            !(name === "frontend" && n === "ingress")),
      )
    )
      throw new Error(`Invalid networks: ${name}`);
    if (networks.includes("ingress")) {
      if (
        name !== "frontend" ||
        networks.length !== 2 ||
        !networks.some((n) => config.networks[n]?.internal) ||
        JSON.stringify(service.entrypoint) !==
          JSON.stringify(["/usr/local/bin/offline-entrypoint.sh"]) ||
        JSON.stringify(service.command) !==
          JSON.stringify(["nginx", "-g", "daemon off;"]) ||
        JSON.stringify(service.dns) !== JSON.stringify(["127.0.0.1"]) ||
        JSON.stringify(service.cap_add) !== JSON.stringify(["NET_ADMIN"]) ||
        !service.cap_drop?.includes("NET_RAW") ||
        !service.security_opt?.includes("no-new-privileges:true") ||
        !service.ports?.length ||
        service.ports.some(
          (p) =>
            p.host_ip !== "127.0.0.1" ||
            p.target !== 80 ||
            p.protocol !== "tcp",
        )
      )
        throw new Error(
          "Frontend ingress must have the fail-closed egress guard and loopback binding",
        );
    }
    const env = service.environment ?? {};
    if (
      env.CLASSIFICATION_LLM_ENABLED !== undefined &&
      String(env.CLASSIFICATION_LLM_ENABLED) !== "false"
    ) {
      throw new Error(
        "Initial bundle requires the implemented local rules profile",
      );
    }
    if (
      env.CLASSIFICATION_LLM_BASE_URL &&
      !/^http:\/\/[a-z][a-z0-9-]*:\d+\/v1$/.test(
        env.CLASSIFICATION_LLM_BASE_URL,
      )
    ) {
      throw new Error("External model endpoint in initial bundle");
    }
  }
  return config;
}
