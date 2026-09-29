// Reproduce the observed five-minute silent-header condition without models,
// user documents, external network access or a lowered timeout in the test.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { postParser } from "../../backend/dist/modules/parsing/parser-post.js";
const directory = path.resolve(process.argv[2] ?? "");
if (!directory.includes(`${path.sep}.test-output${path.sep}matrix-candidate-`))
  throw new Error("Explicit candidate evidence directory required");
const wait = 305_000;
const start = Date.now();
const server = createServer((request, response) => {
  request.resume();
  setTimeout(() => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"synthetic_transport_probe":true}');
  }, wait);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const { port } = server.address();
  const response = await postParser(
    `http://127.0.0.1:${port}/parse`,
    {},
    "{}",
    AbortSignal.timeout(330_000),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { synthetic_transport_probe: true });
  const report = {
    schema_version: 1,
    runtime: process.version,
    completed_at: new Date().toISOString(),
    silent_headers_ms: wait,
    elapsed_ms: Date.now() - start,
    passed: true,
    qualification:
      "real HTTP wait exceeding 300 seconds; synthetic transport only, not PAR performance",
  };
  await writeFile(
    path.join(directory, "transport-probe.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
