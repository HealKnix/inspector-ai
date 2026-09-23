import { useQuery } from "@tanstack/react-query";

import {
  getAdminDocuments,
  getAdminDocumentStats,
  getAdminObjects,
  getAdminParseResult,
  getAdminRenderedPage,
} from "@/api/endpoints/admin-documents";
import { queryKeys } from "@/api/query-keys";
import type {
  AdminDocument,
  AdminDocumentFilters,
  AdminDocumentStatsRange,
} from "@/api/types/admin-documents";

export function useAdminDocuments(filters: AdminDocumentFilters) {
  return useQuery({
    queryKey: queryKeys.admin.documents(filters),
    queryFn: ({ signal }) => getAdminDocuments(filters, signal),
    staleTime: 10_000,
    placeholderData: (previous) => previous,
  });
}

export function useAdminDocumentStats(range: AdminDocumentStatsRange) {
  return useQuery({
    queryKey: queryKeys.admin.documentStats(range),
    queryFn: ({ signal }) => getAdminDocumentStats(range, signal),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
}

export function useAdminObjects() {
  return useQuery({
    queryKey: queryKeys.admin.objects,
    queryFn: ({ signal }) => getAdminObjects(signal),
    staleTime: 60_000,
  });
}

export function useAdminParseResult(document: AdminDocument | null) {
  const artifactId = document?.parsing?.artifact_id;
  return useQuery({
    queryKey: queryKeys.admin.parse(document?.id ?? "", artifactId ?? ""),
    queryFn: ({ signal }) =>
      getAdminParseResult(document!.id, artifactId!, signal),
    enabled: Boolean(document && artifactId),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: 0,
  });
}

export function useAdminRenderedPage(
  fileId: string,
  artifactId: string | null,
  page: number,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.admin.renderedPage(fileId, artifactId ?? "", page),
    queryFn: ({ signal }) =>
      getAdminRenderedPage(fileId, artifactId!, page, signal),
    enabled: enabled && Boolean(artifactId) && page > 0,
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: 0,
  });
}
