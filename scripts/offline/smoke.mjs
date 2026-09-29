// Transport/runtime smoke with explicit synthetic documents; not an OCR accuracy score.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { syntheticDocx } from "../../backend/test/fixtures.ts";

const directory = path.resolve(process.argv[2]);
const manifestSha256 = createHash("sha256")
  .update(await readFile(path.join(directory, "manifest.json")))
  .digest("hex");
const testScriptSha256 = createHash("sha256")
  .update(await readFile(fileURLToPath(import.meta.url)))
  .digest("hex");
const project = process.argv[3];
if (!/^inspector-foundations-[a-z0-9-]+$/.test(project))
  throw new Error(
    "Smoke is restricted to an isolated inspector-foundations-* test project",
  );
const config = Object.fromEntries(
  (await readFile(path.join(directory, `${project}.runtime.env`), "utf8"))
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i), line.slice(i + 1)];
    }),
);
const port = Number(config.OFFLINE_PORT),
  base = `http://127.0.0.1:${port}`;
const checks = [];
function check(name, actual, expected) {
  assert.deepEqual(actual, expected, name);
  checks.push({ name, passed: true });
}
async function request(route, token, body) {
  const response = await fetch(base + "/api/" + route, {
    method: body ? "POST" : "GET",
    headers: {
      "content-type": "application/json",
      "x-inspector-request": "1",
      origin: `http://localhost:${port}`,
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: response.status, data };
}
async function login(login, password) {
  const res = await request("auth/login", null, { login, password });
  check("login " + login, res.status, 200);
  return res.data.accessToken;
}
const admin = await login(config.ADMIN_LOGIN, config.ADMIN_PASSWORD);
const suffix = randomUUID().slice(0, 8),
  password = randomBytes(24).toString("base64url");
const users = [];
for (const name of ["owner", "unassigned"]) {
  const loginName = `offline.${name}.${suffix}`;
  const created = await request("v1/admin/users", admin, {
    login: loginName,
    password,
    lastName: "Синтетический",
    firstName: "Тест",
    role: "INSPECTOR",
  });
  check("create test " + name, created.status, 201);
  users.push(await login(loginName, password));
}
const object = await request("v1/objects", users[0], {
  name: `OFF-initial synthetic transport ${suffix}`,
});
check("create object", object.status, 201);
const objectId = object.data.id;
check(
  "object without assignment denied",
  (await request(`v1/objects/${objectId}`, users[1])).status,
  403,
);
check(
  "audit without assignment denied",
  (await request(`v1/objects/${objectId}/audit-events`, users[1])).status,
  403,
);
check(
  "admin has no implicit object history right",
  (await request(`v1/objects/${objectId}/audit-events`, admin)).status,
  403,
);
const uploadBody = {
  object_id: objectId,
  client_upload_id: randomUUID(),
  files: [
    {
      client_file_id: randomUUID(),
      original_name: "synthetic-offline.docx",
      content_base64: syntheticDocx().toString("base64"),
    },
  ],
};
const accepted = await request("v1/documents/upload", users[0], uploadBody);
check("upload accepted HTTP", accepted.status, 202);
check("document accepted", accepted.data.files[0].accepted, true);
const replay = await request("v1/documents/upload", users[0], uploadBody);
check(
  "upload replay process",
  replay.data.process_id,
  accepted.data.process_id,
);
check(
  "upload replay file",
  replay.data.files[0].file_id,
  accepted.data.files[0].file_id,
);
const fileId = accepted.data.files[0].file_id;
let parsed;
for (let attempt = 0; attempt < 150; attempt++) {
  const response = await request(`v1/objects/${objectId}/parsing`, users[0]);
  assert.equal(response.status, 200);
  parsed = response.data.items.find((item) => item.file_id === fileId);
  if (parsed?.state === "succeeded" || parsed?.state === "failed") break;
  await delay(2000);
}
check("real queued parser completed", parsed?.state, "succeeded");
check("parser artifact exists", typeof parsed.artifact_id, "string");
const artifact = await request(
  `v1/objects/${objectId}/files/${fileId}/parse`,
  users[0],
);
check("read own parse", artifact.status, 200);
check(
  "read foreign parse denied",
  (await request(`v1/objects/${objectId}/files/${fileId}/parse`, users[1]))
    .status,
  403,
);
const history = await request(`v1/objects/${objectId}/audit-events`, users[0]);
check("read own audit", history.status, 200);
check("audit has events", history.data.items.length > 0, true);
const eicar = Buffer.from(
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
);
const rejected = await request("v1/documents/upload", users[0], {
  object_id: objectId,
  client_upload_id: randomUUID(),
  files: [
    {
      client_file_id: randomUUID(),
      original_name: "synthetic-eicar.docx",
      content_base64: syntheticDocx({
        "word/eicar.txt": eicar.toString("ascii"),
      }).toString("base64"),
    },
  ],
});
check("infected document rejected", rejected.data.files?.[0].accepted, false);
check(
  "actual antivirus detected signature",
  rejected.data.files?.[0].error,
  "infected",
);
check(
  "metrics excluded from public ingress",
  (await request("internal/metrics")).status,
  404,
);
const html = await fetch(base);
check("frontend serves offline", html.status, 200);
const markup = await html.text();
const assets = [
  ...new Set(
    [
      ...markup.matchAll(
        /(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/gi,
      ),
    ].map((match) => new URL(match[1], base).href),
  ),
];
check(
  "frontend references entry JavaScript",
  assets.some((url) => new URL(url).pathname.endsWith(".js")),
  true,
);
check(
  "frontend references stylesheet",
  assets.some((url) => new URL(url).pathname.endsWith(".css")),
  true,
);
const frontendAssets = [];
for (const asset of assets) {
  const url = new URL(asset);
  check(`local asset origin ${url.pathname}`, url.origin, base);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    redirect: "error",
  });
  check(`asset HTTP ${url.pathname}`, response.status, 200);
  const mime = response.headers.get("content-type")?.split(";")[0].trim();
  check(
    `asset MIME ${url.pathname}`,
    url.pathname.endsWith(".css")
      ? mime === "text/css"
      : ["application/javascript", "text/javascript"].includes(mime),
    true,
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  check(
    `asset is nonempty and not SPA HTML ${url.pathname}`,
    bytes.length > 0 &&
      !/^\s*(?:<!doctype\s+html|<html\b)/i.test(bytes.toString("utf8")),
    true,
  );
  frontendAssets.push({
    path: url.pathname,
    content_type: mime,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
function docker(args) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
const ids = docker([
  "container",
  "ls",
  "--all",
  "--filter",
  `label=com.docker.compose.project=${project}`,
  "--format",
  "{{.ID}}",
])
  .trim()
  .split(/\s+/);
const inspected = JSON.parse(docker(["inspect", ...ids]));
for (const service of [
  "backend",
  "worker",
  "parsing-worker",
  "classification-worker",
  "extraction-worker",
]) {
  check(
    `${service} has exactly one container`,
    inspected.filter(
      (container) =>
        container.Config.Labels["com.docker.compose.service"] === service,
    ).length,
    1,
  );
}
for (const container of inspected) {
  const service = container.Config.Labels["com.docker.compose.service"];
  if (service === "backend" || service.endsWith("worker")) {
    check(`${service} executes Node`, container.Config.Cmd[0], "node");
    check(`${service} healthy`, container.State.Health.Status, "healthy");
  }
  for (const network of Object.keys(container.NetworkSettings.Networks))
    check(
      `network ${network} has expected isolation for ${service}`,
      JSON.parse(docker(["network", "inspect", network]))[0].Internal,
      !(service === "frontend" && network === `${project}_ingress`),
    );
}
async function runtimeProbe() {
  // This function executes inside backend: the credential never leaves its process.
  const response = await fetch("http://127.0.0.1:3000/api/internal/metrics", {
    headers: { authorization: "Bearer " + process.env.METRICS_TOKEN },
    signal: AbortSignal.timeout(10000),
  });
  if (response.status !== 200) throw Error("metrics endpoint unavailable");
  const metrics = (await response.text()).split(/\r?\n/);
  const sources = {};
  for (const source of ["database", "storage", "rabbitmq"]) {
    const name = `inspector_metrics_source_up{source="${source}"}`;
    const samples = metrics.filter((line) => line.startsWith(name + " "));
    if (samples.length !== 1 || samples[0] !== name + " 1")
      throw Error("metrics source unavailable: " + source);
    sources[source] = 1;
  }
  let blocked = false;
  try {
    await fetch("http://1.1.1.1/", { signal: AbortSignal.timeout(2500) });
  } catch {
    blocked = true;
  }
  if (!blocked) throw Error("egress available");
  const { Resolver } = await import("node:dns/promises");
  const resolver = new Resolver({ timeout: 2000, tries: 1 });
  let dnsBlocked = false;
  try {
    await resolver.resolve4("example.com");
  } catch {
    dnsBlocked = true;
  }
  if (!dnsBlocked) throw Error("external DNS available");
  console.log(
    JSON.stringify({
      node: process.version,
      metrics: true,
      metric_sources: sources,
      egress_blocked: blocked,
      external_dns_blocked: dnsBlocked,
    }),
  );
}
const probe = `(${runtimeProbe.toString()})()`;
const frontend = inspected.find(
  (c) => c.Config.Labels["com.docker.compose.service"] === "frontend",
);
check("frontend DNS has no external resolver", frontend.HostConfig.Dns, [
  "127.0.0.1",
]);
check(
  "frontend drops raw socket capability",
  frontend.HostConfig.CapDrop.some(
    (capability) => capability.replace(/^CAP_/, "") === "NET_RAW",
  ),
  true,
);
const backend = inspected.find(
  (c) => c.Config.Labels["com.docker.compose.service"] === "backend",
);
const backendIp =
  backend.NetworkSettings.Networks[`${project}_offline`]?.IPAddress;
assert.match(
  backendIp,
  /^\d{1,3}(?:\.\d{1,3}){3}$/,
  "backend IPv4 on the internal network",
);
const commonRules = [
  "-P OUTPUT DROP",
  "-A OUTPUT -o lo -j ACCEPT",
  "-A OUTPUT -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT",
];
const firewall = {};
for (const [family, command, expected] of [
  [
    "IPv4",
    "iptables",
    [
      ...commonRules,
      `-A OUTPUT -d ${backendIp}/32 -p tcp -m tcp --dport 3000 -j ACCEPT`,
    ],
  ],
  ["IPv6", "ip6tables", commonRules],
]) {
  const rules = docker([
    "exec",
    `${project}-frontend-1`,
    command,
    "-S",
    "OUTPUT",
  ])
    .trim()
    .split(/\r?\n/);
  check(`frontend ${family} exact OUTPUT allowlist`, rules, expected);
  firewall[family] = rules;
}
const guard = docker([
  "exec",
  `${project}-frontend-1`,
  "cat",
  "/proc/1/status",
]);
const cap = BigInt("0x" + guard.match(/^CapBnd:\s*([a-f0-9]+)/m)[1]);
check("nginx cannot alter firewall", (cap & (1n << 12n)) === 0n, true);
check(
  "nginx cannot bypass firewall with raw socket",
  (cap & (1n << 13n)) === 0n,
  true,
);
check(
  "nginx cannot gain new privileges",
  /^NoNewPrivs:\s*1$/m.test(guard),
  true,
);
const frontendBlocked = docker([
  "exec",
  `${project}-frontend-1`,
  "sh",
  "-eu",
  "-c",
  "wget -T 3 -q -O /dev/null http://127.0.0.1/; if wget -T 3 -q -O /dev/null http://1.1.1.1/ 2>/dev/null; then exit 1; fi; if timeout 5 nslookup example.com >/dev/null 2>&1; then exit 1; fi; printf blocked",
]);
check("frontend external HTTP and DNS blocked", frontendBlocked, "blocked");
const runtime = JSON.parse(
  docker([
    "exec",
    `${project}-backend-1`,
    "node",
    "--input-type=module",
    "-e",
    probe,
  ]),
);
check("Node runtime", runtime.node, "v24.16.0");
check("all real metric sources available", runtime.metric_sources, {
  database: 1,
  storage: 1,
  rabbitmq: 1,
});
check("external egress blocked", runtime.egress_blocked, true);
check("external DNS blocked", runtime.external_dns_blocked, true);
const report = {
  schema_version: 1,
  manifest_sha256: manifestSha256,
  test_script_sha256: testScriptSha256,
  project,
  finished_at: new Date().toISOString(),
  scope:
    "synthetic runtime/transport/ACL/idempotency/antivirus smoke; not quality acceptance",
  object_id: objectId,
  file_id: fileId,
  process_id: accepted.data.process_id,
  run_id: accepted.data.run_id,
  parser: parsed,
  runtime,
  frontend_assets: frontendAssets,
  frontend_firewall: {
    image_id: frontend.Image,
    backend_ip: backendIp,
    rules: firewall,
  },
  checks,
};
await writeFile(
  path.join(directory, `${project}.smoke.json`),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    passed: checks.length,
    project,
    parser_state: parsed.state,
    report: `${project}.smoke.json`,
  }),
);
