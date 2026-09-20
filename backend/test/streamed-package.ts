import { randomUUID } from "node:crypto";

/** Synthetic XML with a valid root and trailing whitespace, without allocating the package. */
export function* streamedPackage(
  objectId: string,
  uploadId: string,
  sizes: number[],
) {
  yield '{"object_id":' +
    JSON.stringify(objectId) +
    ',"client_upload_id":' +
    JSON.stringify(uploadId) +
    ',"files":[';
  for (const [index, size] of sizes.entries()) {
    yield (index ? "," : "") +
      '{"client_file_id":' +
      JSON.stringify(randomUUID()) +
      ',"original_name":"synthetic-limit.xml","content_base64":"';
    for (let offset = 0; offset < size; offset += 49_152) {
      const chunk = Buffer.alloc(Math.min(49_152, size - offset), 32);
      // Distinct contents keep the boundary test about four admitted files, not duplicates.
      if (offset === 0) chunk.write('<r n="' + index + '"/>');
      yield chunk.toString("base64");
    }
    yield '"}';
  }
  yield "]}";
}
