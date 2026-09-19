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
    classification: (id: string) => ["objects", id, "classification"] as const,
    extractions: (id: string) => ["objects", id, "extractions"] as const,
    evidenceGroups: (id: string) => ["objects", id, "evidence-groups"] as const,
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
  matrix: {
    all: ["admin", "matrix"] as const,
    rows: ["admin", "matrix", "rows"] as const,
    rules: (parameterCode: string) =>
      ["admin", "matrix", "rules", parameterCode] as const,
  },
} as const;
