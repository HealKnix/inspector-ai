import {
  createObject,
  getObject,
  getReceipt,
  listFiles,
  listObjects,
  uploadDocuments,
} from "@/api/endpoints/objects";
import { queryKeys } from "@/api/query-keys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export function useObjects(page: number) {
  return useQuery({
    queryKey: queryKeys.objects.list(page),
    queryFn: ({ signal }) => listObjects(page, signal),
    retry: false,
  });
}
export function useObject(id: string) {
  return useQuery({
    queryKey: queryKeys.objects.detail(id),
    queryFn: ({ signal }) => getObject(id, signal),
    retry: false,
  });
}
export function useFiles(id: string, page: number, limit = 20) {
  return useQuery({
    queryKey: queryKeys.objects.files(id, page, limit),
    queryFn: ({ signal }) => listFiles(id, page, limit, signal),
    retry: false,
  });
}
export function useReceipt(
  id: string,
  uploadId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.objects.receipt(id, uploadId ?? ""),
    queryFn: ({ signal }) => getReceipt(id, uploadId!, signal),
    enabled: enabled && Boolean(uploadId),
    retry: false,
  });
}
export function useCreateObject() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: createObject,
    retry: false,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.objects.all });
    },
  });
}
export function useUploadDocuments() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: uploadDocuments,
    retry: false,
    onSuccess: async (data) => {
      await client.cancelQueries({
        queryKey: queryKeys.objects.receipt(
          data.object_id,
          data.client_upload_id,
        ),
      });
      client.setQueryData(
        queryKeys.objects.receipt(data.object_id, data.client_upload_id),
        data,
      );
      await client.invalidateQueries({
        queryKey: [...queryKeys.objects.detail(data.object_id), "files"],
      });
      await client.invalidateQueries({
        queryKey: queryKeys.objects.parsing(data.object_id),
      });
    },
  });
}
