// Local, opt-in admission regression. Never sends document contents outside localhost.
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, extname, relative, resolve } from "node:path";
import { Readable } from "node:stream";

const root = resolve(process.argv[2] ?? "");
if (
  !process.argv[2] ||
  !process.env.CORPUS_LOGIN ||
  !process.env.CORPUS_PASSWORD
)
  throw new Error(
    "Usage: CORPUS_LOGIN/CORPUS_PASSWORD node test/admission-corpus.mjs <approved-local-directory>",
  );
const base = process.env.CORPUS_API ?? "http://localhost:3303/api";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw new Error("Local test API required");
const output = resolve(
  process.env.CORPUS_REPORT ?? ".test-output/corpus-" + Date.now(),
);
await mkdir(output, { recursive: true });
let token;
let authenticatedAt = 0;
async function login() {
  const response = await fetch(base + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Inspector-Request": "1" },
    body: JSON.stringify({
      login: process.env.CORPUS_LOGIN,
      password: process.env.CORPUS_PASSWORD,
    }),
  });
  if (!response.ok) throw new Error("Test login failed: " + response.status);
  token = (await response.json()).accessToken;
  authenticatedAt = Date.now();
}
await login();
const previous = await readFile(output + "/summary.json", "utf8")
  .then(JSON.parse)
  .catch(() => null);
let objectId = previous?.object_id;
if (!objectId) {
  const created = await fetch(base + "/v1/objects", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: JSON.stringify({ name: "Корпус проверки приёма: " + basename(root) }),
  });
  if (!created.ok)
    throw new Error("Cannot create corpus object: " + created.status);
  objectId = (await created.json()).id;
}
async function* paths(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) yield* paths(path);
    else if (
      entry.isFile() &&
      [".pdf", ".docx", ".xml"].includes(extname(entry.name).toLowerCase())
    )
      yield path;
  }
}
const started = Date.now();
let count = previous?.count ?? 0;
let accepted = previous?.accepted ?? 0;
const reasons = previous?.reasons ?? {};
const completed = new Set(
  (await readFile(output + "/results.jsonl", "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line).path),
);
const pending = [];
for await (const path of paths(root))
  if (!completed.has(relative(root, path))) pending.push(path);
let writing = Promise.resolve();
async function check(path) {
  if (Date.now() - authenticatedAt > 600_000) await login();
  const size = (await stat(path)).size;
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  const sha256 = digest.digest("hex");
  const clientUploadId = randomUUID();
  async function* body() {
    yield `{"object_id":"${objectId}","client_upload_id":"${clientUploadId}","files":[{"client_file_id":"${randomUUID()}","original_name":${JSON.stringify(basename(path))},"content_base64":"`;
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
    yield '"}]}';
  }
  const response = await fetch(base + "/v1/documents/upload", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
    },
    body: Readable.from(body()),
    duplex: "half",
    signal: AbortSignal.timeout(650_000),
  });
  const result = await response.json();
  const file = result.files?.[0];
  let downloadHash = null;
  if (file?.accepted) {
    const download = await fetch(
      base + `/v1/objects/${objectId}/files/${file.file_id}/original`,
      { headers: { Authorization: "Bearer " + token } },
    );
    if (!download.ok) throw new Error("Original not accessible");
    const hash = createHash("sha256");
    for await (const chunk of download.body) hash.update(chunk);
    downloadHash = hash.digest("hex");
    if (file.sha256 !== sha256 || downloadHash !== sha256)
      throw new Error("Original hash mismatch");
    accepted++;
  } else {
    const reason = file?.error ?? "http_" + response.status;
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  count++;
  const summary = {
    object_id: objectId,
    count,
    accepted,
    rejected: count - accepted,
    reasons: { ...reasons },
    elapsed_seconds:
      (previous?.elapsed_seconds ?? 0) +
      Math.round((Date.now() - started) / 1000),
  };
  writing = writing.then(async () => {
    await appendFile(
      output + "/results.jsonl",
      JSON.stringify({
        path: relative(root, path),
        size,
        sha256,
        download_sha256: downloadHash,
        status: response.status,
        outcome: file ?? result,
      }) + "\n",
    );
    await writeFile(output + "/summary.json", JSON.stringify(summary, null, 2));
  });
  await writing;
  process.stdout.write(JSON.stringify(summary) + "\n");
}
const concurrency = Math.min(
  4,
  Math.max(1, Number(process.env.CORPUS_CONCURRENCY) || 1),
);
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    for (let path; (path = pending.shift());) await check(path);
  }),
);
process.stdout.write("Report: " + output + "\n");
