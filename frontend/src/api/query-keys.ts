export const queryKeys = {
  objects: {
    all: ["objects"] as const,
    list: (page: number) => ["objects", "list", page] as const,
    detail: (id: string) => ["objects", id] as const,
    files: (id: string, page: number) =>
      ["objects", id, "files", page] as const,
    receipt: (id: string, uploadId: string) =>
      ["objects", id, "receipt", uploadId] as const,
    parsing: (id: string) => ["objects", id, "parsing"] as const,
    parse: (id: string, fileId: string, runId: string, artifactId: string) =>
      ["objects", id, "parse", fileId, runId, artifactId] as const,
    renderedPage: (
      id: string,
      fileId: string,
      runId: string,
      artifactId: string,
      page: number,
    ) =>
      [
        "objects",
        id,
        "parse",
        fileId,
        runId,
        artifactId,
        "page",
        page,
      ] as const,
  },
  auth: {
    currentUser: ["auth", "current-user"] as const,
  },
} as const;
