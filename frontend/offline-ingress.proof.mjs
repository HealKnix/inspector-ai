// Disposable transport/firewall proof. Never uses a saved application project.
/* global process, fetch, AbortSignal, console */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const image = process.argv[2] ?? "inspector-offline-ingress-proof:20260927";
const prefix = "inspector-ingress-proof-" + randomUUID().slice(0, 8);
const core = prefix + "-core",
  ingress = prefix + "-ingress";
const backend = prefix + "-backend",
  sink = prefix + "-sink",
  frontend = prefix + "-frontend";
const containers = [],
  networks = [],
  checks = [];
function docker(args, required = true) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    timeout: 30_000,
  });
  if (required)
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result;
}
function check(name, value) {
  assert.ok(value, name);
  checks.push(name);
}
function run(name, args) {
  docker(["run", "-d", "--name", name, ...args]);
  containers.push(name);
}
function inspect(name) {
  return JSON.parse(docker(["inspect", name]).stdout)[0];
}
const stub = `import http from 'node:http'; for(const port of [3000,3001])http.createServer((q,s)=>s.end('synthetic-offline-backend')).listen(port,'0.0.0.0');`;
const receiver = `import http from 'node:http';import dgram from 'node:dgram';http.createServer((q,s)=>s.end('synthetic-egress-receiver')).listen(3000,'::');const d=dgram.createSocket('udp4');d.on('message',(q,r)=>{const e=q.indexOf(0,12);if(e<0)return;const h=Buffer.from(q.subarray(0,12));h.writeUInt16BE(0x8180,2);h.writeUInt16BE(1,4);const a=q.readUInt16BE(e+1)===1;h.writeUInt16BE(a?1:0,6);h.writeUInt32BE(0,8);const answer=Buffer.from([192,12,0,1,0,1,0,0,0,0,0,4,203,0,113,3]);d.send(Buffer.concat([h,q.subarray(12,e+5),...(a?[answer]:[])]),r.port,r.address);});d.bind(53,'0.0.0.0');`;
try {
  docker(["network", "create", "--internal", core]);
  networks.push(core);
  docker(["network", "create", "--ipv6", ingress]);
  networks.push(ingress);
  run(backend, [
    "--network",
    core,
    "--network-alias",
    "backend",
    "node:24.16.0-bookworm-slim",
    "node",
    "--input-type=module",
    "-e",
    stub,
  ]);
  run(sink, [
    "--network",
    ingress,
    "node:24.16.0-bookworm-slim",
    "node",
    "--input-type=module",
    "-e",
    receiver,
  ]);
  const sinkNetwork = inspect(sink).NetworkSettings.Networks[ingress];
  const backendIp = inspect(backend).NetworkSettings.Networks[core].IPAddress;
  const control = (...command) =>
    docker([
      "run",
      "--rm",
      "--network",
      ingress,
      "--entrypoint",
      command[0],
      image,
      ...command.slice(1),
    ]);
  check(
    "control receiver reachable via IPv4",
    control(
      "wget",
      "-qO-",
      "-T",
      "3",
      `http://${sinkNetwork.IPAddress}:3000/`,
    ).stdout.includes("synthetic-egress-receiver"),
  );
  check(
    "control receiver reachable via IPv6",
    control(
      "wget",
      "-qO-",
      "-T",
      "3",
      `http://[${sinkNetwork.GlobalIPv6Address}]:3000/`,
    ).stdout.includes("synthetic-egress-receiver"),
  );
  check(
    "control DNS receiver answers",
    control("nslookup", "example.com", sinkNetwork.IPAddress).stdout.includes(
      "203.0.113.3",
    ),
  );

  run(frontend, [
    "--network",
    core,
    "--network",
    ingress,
    "--dns",
    "127.0.0.1",
    "--cap-add",
    "NET_ADMIN",
    "--cap-drop",
    "NET_RAW",
    "--security-opt",
    "no-new-privileges:true",
    "-p",
    "127.0.0.1::80",
    image,
  ]);
  let url;
  for (let attempt = 0; attempt < 40; attempt++) {
    const state = inspect(frontend);
    if (!state.State.Running) {
      const logs = docker(["logs", frontend]);
      throw new Error(logs.stdout + logs.stderr + state.State.Error);
    }
    const port = state.NetworkSettings.Ports["80/tcp"]?.[0]?.HostPort;
    if (port) {
      url = `http://127.0.0.1:${port}`;
      try {
        if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) break;
      } catch {
        /* bounded startup poll */
      }
    }
    await delay(250);
  }
  check(
    "nginx serves host loopback",
    (await fetch(url, { signal: AbortSignal.timeout(3000) })).status === 200,
  );
  check(
    "nginx reaches only backend:3000",
    (await (
      await fetch(url + "/api/proof", { signal: AbortSignal.timeout(3000) })
    ).text()) === "synthetic-offline-backend",
  );
  const execute = (...args) => docker(["exec", frontend, ...args]);
  const denied = (...args) =>
    docker(["exec", frontend, "timeout", "4", ...args], false).status !== 0;
  check(
    "IPv4 OUTPUT defaults DROP",
    execute("iptables", "-S", "OUTPUT").stdout.startsWith("-P OUTPUT DROP"),
  );
  check(
    "IPv6 OUTPUT defaults DROP",
    execute("ip6tables", "-S", "OUTPUT").stdout.startsWith("-P OUTPUT DROP"),
  );
  const status = execute("cat", "/proc/1/status").stdout;
  for (const key of ["CapBnd", "CapEff", "CapPrm", "CapInh", "CapAmb"]) {
    const value = BigInt(
      "0x" + status.match(new RegExp(`^${key}:\\s*([0-9a-f]+)`, "m"))[1],
    );
    check(
      `${key} excludes NET_ADMIN and NET_RAW`,
      (value & ((1n << 12n) | (1n << 13n))) === 0n,
    );
  }
  check("nginx cannot gain privileges", /^NoNewPrivs:\s*1$/m.test(status));
  check(
    "same backend other port blocked",
    denied("wget", "-qO-", "-T", "2", `http://${backendIp}:3001/`),
  );
  check(
    "other host IPv4 HTTP blocked",
    denied("wget", "-qO-", "-T", "2", `http://${sinkNetwork.IPAddress}:3000/`),
  );
  check(
    "other host IPv6 HTTP blocked",
    denied(
      "wget",
      "-qO-",
      "-T",
      "2",
      `http://[${sinkNetwork.GlobalIPv6Address}]:3000/`,
    ),
  );
  check(
    "direct external DNS blocked",
    denied("nslookup", "example.com", sinkNetwork.IPAddress),
  );
  check(
    "Docker DNS cannot forward external names",
    denied("nslookup", "example.com"),
  );

  const missingCap = prefix + "-missing-cap";
  run(missingCap, [
    "--network",
    core,
    "--network",
    ingress,
    "--dns",
    "127.0.0.1",
    image,
  ]);
  for (
    let attempt = 0;
    attempt < 40 && inspect(missingCap).State.Running;
    attempt++
  )
    await delay(100);
  check(
    "startup without NET_ADMIN fails closed",
    inspect(missingCap).State.ExitCode !== 0 &&
      !inspect(missingCap).State.Running,
  );
  console.log(
    JSON.stringify(
      {
        image,
        image_id: inspect(frontend).Image,
        passed: checks.length,
        checks,
      },
      null,
      2,
    ),
  );
} finally {
  for (const name of containers.reverse()) docker(["rm", "-f", name], false);
  for (const name of networks.reverse()) docker(["network", "rm", name], false);
}
