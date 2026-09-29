import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  relativeAsset,
  sha256,
  validateOfflineCompose,
  verifyBundle,
} from "./manifest.mjs";

test("release has no runtime build, pull, external network or model endpoint", () => {
  const valid = () => ({
    networks: { offline: { internal: true } },
    services: {
      backend: {
        image: "inspector-backend:test",
        pull_policy: "never",
        networks: ["offline"],
        environment: { CLASSIFICATION_LLM_ENABLED: "false" },
      },
    },
  });
  assert.equal(
    validateOfflineCompose(valid()).services.backend.image,
    "inspector-backend:test",
  );
  for (const mutate of [
    (c) => (c.networks.offline.internal = false),
    (c) => (c.services.backend.build = "."),
    (c) => (c.services.backend.pull_policy = "always"),
    (c) => (c.services.backend.network_mode = "host"),
    (c) => (c.services.backend.environment.CLASSIFICATION_LLM_ENABLED = "true"),
    (c) =>
      (c.services.backend.environment.CLASSIFICATION_LLM_BASE_URL =
        "https://remote.invalid/v1"),
  ]) {
    const value = valid();
    mutate(value);
    assert.throws(() => validateOfflineCompose(value));
  }
});

test("only guarded loopback frontend may use ingress; core and DNS escape are rejected", () => {
  const valid = () => ({
    networks: {
      offline: { internal: true },
      ingress: { driver: "bridge", internal: false },
    },
    services: {
      backend: {
        image: "inspector-backend:test",
        pull_policy: "never",
        networks: ["offline"],
      },
      frontend: {
        image: "inspector-frontend:test",
        pull_policy: "never",
        networks: ["offline", "ingress"],
        entrypoint: ["/usr/local/bin/offline-entrypoint.sh"],
        command: ["nginx", "-g", "daemon off;"],
        dns: ["127.0.0.1"],
        cap_add: ["NET_ADMIN"],
        cap_drop: ["NET_RAW"],
        security_opt: ["no-new-privileges:true"],
        ports: [
          {
            host_ip: "127.0.0.1",
            target: 80,
            published: 18080,
            protocol: "tcp",
          },
        ],
      },
    },
  });
  assert.ok(validateOfflineCompose(valid()));
  for (const mutate of [
    (c) => c.services.backend.networks.push("ingress"),
    (c) => (c.services.frontend.entrypoint = ["nginx"]),
    (c) => delete c.services.frontend.command,
    (c) => (c.services.frontend.dns = ["8.8.8.8"]),
    (c) => (c.services.frontend.cap_drop = []),
    (c) => (c.services.frontend.ports[0].host_ip = "0.0.0.0"),
    (c) => delete c.networks.ingress,
    (c) => (c.networks.offline.external = true),
  ]) {
    const config = valid();
    mutate(config);
    assert.throws(() => validateOfflineCompose(config));
  }
});

test("manifest checks contents and rejects duplicate/path traversal assets before installation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "inspector-offline-test-"));
  try {
    const files = [];
    for (const name of [
      "images.tar",
      "compose.json",
      "catalog.json",
      "assets/models.tar",
      "assets/clamav.tar",
      "tools/restore-assets.py",
    ]) {
      const file = path.join(root, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, "fixture");
      files.push({ path: name, bytes: 7, sha256: await sha256(file) });
    }
    const manifest = {
      schema_version: 1,
      files,
      images: [
        { reference: "inspector-backend:test", id: "sha256:" + "a".repeat(64) },
      ],
    };
    await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
    assert.equal((await verifyBundle(root)).manifest.files.length, 6);
    for (const file of files) {
      await writeFile(path.join(root, file.path), "changed");
      await assert.rejects(verifyBundle(root), /verification failed/);
      await writeFile(path.join(root, file.path), "fixture");
    }
    manifest.files.push(files[0]);
    await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest));
    await assert.rejects(verifyBundle(root), /Invalid asset metadata/);
    for (const invalid of [
      "../secret",
      "/etc/passwd",
      "C:/secret",
      "assets/../secret",
      "assets\\secret",
      "assets//x",
    ])
      assert.throws(() => relativeAsset(invalid));
  } finally {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith("inspector-offline-test-"));
    await rm(root, { recursive: true, force: true });
  }
});
