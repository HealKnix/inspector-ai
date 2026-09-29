import { request as httpRequest, type OutgoingHttpHeaders } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";

/** OCR may legitimately produce no response headers for more than five minutes.
 * Node fetch imposes its own headers deadline; Bun's `timeout: false` does not
 * configure Node. Native HTTP leaves the bounded caller signal in sole control
 * of this request. Health/progress/cancel retain their short fetch deadlines. */
export function postParser(
  url: string,
  headers: OutgoingHttpHeaders,
  body: string,
  signal: AbortSignal,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (!["http:", "https:"].includes(target.protocol)) {
      reject(new Error("Invalid parser protocol"));
      return;
    }
    const request = (target.protocol === "https:" ? httpsRequest : httpRequest)(
      target,
      {
        method: "POST",
        headers: { ...headers, "Content-Length": Buffer.byteLength(body) },
        signal,
        agent: false,
      },
      (incoming) => {
        try {
          const status = incoming.statusCode ?? 500;
          const empty = [204, 205, 304].includes(status);
          const stream = empty ? null : Readable.toWeb(incoming);
          if (empty) incoming.resume();
          resolve(
            new Response(stream as ReadableStream<Uint8Array> | null, {
              status,
            }),
          );
        } catch (error) {
          incoming.destroy();
          reject(
            error instanceof Error
              ? error
              : new Error("Invalid parser response"),
          );
        }
      },
    );
    request.setTimeout(0);
    request.once("error", reject);
    request.end(body);
  });
}
