#!/usr/bin/env node
// Загрузка нескольких файлов ОДНИМ пакетом: один процесс, один run, все файлы
// в run_inputs — необходимо для кросс-документной сверки (evidence groups
// собираются в пределах одного процесса).
//
//   node scripts/upload-batch.mjs --api http://localhost:8082 \
//     --login u --password p --name "Объект" --files a.pdf b.pdf ...

const args = parseArgs(process.argv.slice(2));
const API = (args.api ?? "http://localhost:8082").replace(/\/$/, "");
const LOGIN = required(args.login, "--login");
const PASSWORD = required(args.password, "--password");
const NAME = args.name;
const OBJECT = args.object; // существующий объект — пропуск создания
const PROCESS = args.process; // дозагрузка в существующий процесс
const FILES = (Array.isArray(args.files) ? args.files : [args.files])
  .filter(Boolean)
  .flatMap((v) => String(v).split(","))
  .map((v) => v.trim())
  .filter(Boolean);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const [key, inline] = arg.slice(2).split("=", 2);
    const value = inline ?? (argv[i + 1]?.startsWith("--") ? true : argv[++i]);
    // Повторяющиеся флаги (--files a --files b) накапливаются в массив.
    if (out[key] !== undefined) {
      out[key] = Array.isArray(out[key])
        ? [...out[key], value]
        : [out[key], value];
    } else {
      out[key] = value;
    }
  }
  return out;
}
function required(value, name) {
  if (!value) {
    console.error(`${name} обязателен`);
    process.exit(2);
  }
  return value;
}
if (!FILES.length) {
  console.error("--files обязателен");
  process.exit(2);
}

const { createReadStream } = await import("node:fs");
const { basename } = await import("node:path");
const { randomUUID } = await import("node:crypto");
const { Readable } = await import("node:stream");

async function api(path, { method = "GET", body, token, raw } = {}) {
  const headers = { "x-inspector-request": "1" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !raw) headers["Content-Type"] = "application/json";
  const response = await fetch(`${API}/api${path}`, {
    method,
    headers,
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    duplex: "half",
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 300) };
  }
  return { status: response.status, data };
}

const login = await api("/auth/login", {
  method: "POST",
  body: { login: LOGIN, password: PASSWORD },
});
if (login.status !== 200)
  throw new Error(`login: HTTP ${login.status} ${JSON.stringify(login.data)}`);
const token = login.data.accessToken;

let objectId = OBJECT;
if (!objectId) {
  if (!NAME) {
    console.error("--name обязателен при создании объекта");
    process.exit(2);
  }
  const object = await api("/v1/objects", {
    method: "POST",
    body: { name: NAME },
    token,
  });
  if (object.status !== 200 && object.status !== 201)
    throw new Error(
      `object: HTTP ${object.status} ${JSON.stringify(object.data)}`,
    );
  objectId = object.data.id ?? object.data.object_id;
}
console.log(`Объект: ${objectId}`);

// Один пакет: манифест, затем файлы подряд (base64-стримы).
const clientUploadId = randomUUID();
async function* body() {
  yield `{"object_id":"${objectId}",${PROCESS ? `"process_id":"${PROCESS}",` : ""}"client_upload_id":"${clientUploadId}","files":[`;
  let first = true;
  for (const path of FILES) {
    if (!first) yield ",";
    first = false;
    yield `{"client_file_id":"${randomUUID()}","original_name":${JSON.stringify(basename(path))},"content_base64":"`;
    let carry = Buffer.alloc(0);
    for await (const bytes of createReadStream(path, {
      highWaterMark: 49152,
    })) {
      const chunk = Buffer.concat([carry, bytes]);
      const end = chunk.length - (chunk.length % 3);
      yield chunk.subarray(0, end).toString("base64");
      carry = chunk.subarray(end);
    }
    if (carry.length) yield carry.toString("base64");
    yield '"}';
  }
  yield "]}";
}

const response = await fetch(`${API}/api/v1/documents/upload`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-inspector-request": "1",
    Authorization: `Bearer ${token}`,
  },
  body: Readable.from(body()),
  duplex: "half",
  signal: AbortSignal.timeout(600_000),
});
const result = await response.json();
console.log(`HTTP ${response.status}`);
for (const file of result.files ?? []) {
  console.log(
    ` ${file.accepted ? "ok" : "FAIL"} ${file.original_name} ${file.file_id ?? file.error ?? ""}`,
  );
}
console.log(`process_id: ${result.process_id ?? result.processId ?? "?"}`);
