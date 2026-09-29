import { createServer, type RequestListener, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { postParser } from "./parser-post.js";

let server: Server | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
  server = undefined;
});
async function listen(handler: RequestListener) {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Port missing");
  return `http://127.0.0.1:${address.port}/parse`;
}
describe("bounded long-running parser HTTP", () => {
  it("waits for delayed headers without using runtime fetch and sends the exact UTF-8 payload", async () => {
    const fetch = vi.fn(() => {
      throw new Error("Runtime fetch must not control OCR timeout");
    });
    vi.stubGlobal("fetch", fetch);
    const url = await listen((request, response) => {
      const bytes: Buffer[] = [];
      request.on("data", (chunk: Buffer) => bytes.push(chunk));
      request.on("end", () =>
        setTimeout(() => {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            JSON.stringify({
              body: Buffer.concat(bytes).toString("utf8"),
              auth: request.headers.authorization,
            }),
          );
        }, 80),
      );
    });
    const result = await postParser(
      url,
      { Authorization: "Bearer synthetic" },
      "Коэффициент 36,25%",
      AbortSignal.timeout(2000),
    );
    expect(await result.json()).toEqual({
      body: "Коэффициент 36,25%",
      auth: "Bearer synthetic",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("aborts an admitted request before response headers when the caller deadline expires", async () => {
    const url = await listen(() => {});
    await expect(
      postParser(url, {}, "{}", AbortSignal.timeout(50)),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
  it("preserves admission status when the response stream resets", async () => {
    const url = await listen((_request, response) => {
      response.writeHead(200);
      response.write('{"partial":');
      setTimeout(() => response.destroy(), 40);
    });
    const result = await postParser(url, {}, "{}", AbortSignal.timeout(2000));
    expect(result.status).toBe(200);
    await expect(result.json()).rejects.toBeDefined();
  });
  it("does not follow a redirect carrying the internal authorization header", async () => {
    const url = await listen((_request, response) => {
      response.writeHead(302, { location: "http://unrelated.invalid" });
      response.end("{}");
    });
    const result = await postParser(
      url,
      { Authorization: "Bearer synthetic" },
      "{}",
      AbortSignal.timeout(2000),
    );
    expect(result.status).toBe(302);
    expect(await result.json()).toEqual({});
  });
});
