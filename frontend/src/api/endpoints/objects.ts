import { apiClient } from "@/api/client";
import {
  fileListSchema,
  objectListSchema,
  objectSchema,
  uploadResponseSchema,
  type SelectedFile,
} from "@/api/types/objects";

export async function listObjects(page: number, signal?: AbortSignal) {
  return objectListSchema.parse(
    (await apiClient.get<unknown>("/v1/objects", { params: { page }, signal }))
      .data,
  );
}
export async function createObject(name: string) {
  return objectSchema.parse(
    (await apiClient.post<unknown>("/v1/objects", { name })).data,
  );
}
export async function getObject(id: string, signal?: AbortSignal) {
  return objectSchema.parse(
    (await apiClient.get<unknown>("/v1/objects/" + id, { signal })).data,
  );
}
export async function listFiles(
  id: string,
  page: number,
  signal?: AbortSignal,
) {
  return fileListSchema.parse(
    (
      await apiClient.get<unknown>("/v1/objects/" + id + "/files", {
        params: { page },
        signal,
      })
    ).data,
  );
}
export async function getReceipt(
  id: string,
  uploadId: string,
  signal?: AbortSignal,
) {
  return uploadResponseSchema.parse(
    (
      await apiClient.get<unknown>(
        "/v1/objects/" + id + "/uploads/" + uploadId,
        { signal },
      )
    ).data,
  );
}

export async function buildUploadBody(
  objectId: string,
  uploadId: string,
  files: SelectedFile[],
) {
  const parts: BlobPart[] = [
    '{"object_id":' +
      JSON.stringify(objectId) +
      ',"client_upload_id":' +
      JSON.stringify(uploadId) +
      ',"files":[',
  ];
  for (const [index, item] of files.entries()) {
    parts.push(
      (index ? "," : "") +
        '{"client_file_id":' +
        JSON.stringify(item.id) +
        ',"original_name":' +
        JSON.stringify(item.file.name) +
        ',"content_base64":"',
    );
    // Multiples of three avoid interior base64 padding; Blob avoids one huge JSON string.
    for (let offset = 0; offset < item.file.size; offset += 49_152) {
      const bytes = new Uint8Array(
        await item.file.slice(offset, offset + 49_152).arrayBuffer(),
      );
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      parts.push(new Blob([btoa(binary)]));
    }
    parts.push('"}');
  }
  parts.push("]}");
  return new Blob(parts, { type: "application/json" });
}

export async function uploadDocuments(input: {
  objectId: string;
  uploadId: string;
  files: SelectedFile[];
  onProgress: (percent: number) => void;
}) {
  const body = await buildUploadBody(
    input.objectId,
    input.uploadId,
    input.files,
  );
  const response = await apiClient.post<unknown>("/v1/documents/upload", body, {
    headers: { "Content-Type": "application/json" },
    timeout: 650_000,
    validateStatus: (status) => status === 202 || status === 422,
    onUploadProgress: (event) => {
      if (event.total)
        input.onProgress(Math.round((event.loaded * 100) / event.total));
    },
  });
  return uploadResponseSchema.parse(response.data);
}

export async function downloadOriginal(
  objectId: string,
  fileId: string,
  name: string,
) {
  const response = await apiClient.get<Blob>(
    "/v1/objects/" + objectId + "/files/" + fileId + "/original",
    { responseType: "blob", timeout: 120_000 },
  );
  const url = URL.createObjectURL(response.data);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
