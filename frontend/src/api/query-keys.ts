export const queryKeys = {
  objects: {
    all: ["objects"] as const,
    list: (page: number) => ["objects", "list", page] as const,
    detail: (id: string) => ["objects", id] as const,
    files: (id: string, page: number, limit: number) =>
      ["objects", id, "files", page, limit] as const,
    receipt: (id: string, uploadId: string) =>
      ["objects", id, "receipt", uploadId] as const,
    parsing: (id: string) => ["objects", id, "parsing"] as const,
    classification: (id: string) => ["objects", id, "classification"] as const,
    identification: (id: string) => ["objects", id, "identification"] as const,
    completenessPackage: (id: string) =>
      ["objects", id, "completeness", "package"] as const,
    completenessResult: (id: string, runId?: string) =>
      ["objects", id, "completeness", "result", runId ?? "latest"] as const,
    extractions: (id: string) => ["objects", id, "extractions"] as const,
    evidenceGroups: (id: string) => ["objects", id, "evidence-groups"] as const,
    protocol: (id: string) => ["objects", id, "protocol"] as const,
    findings: (id: string) => ["objects", id, "findings"] as const,
    finding: (id: string, findingId: string) =>
      ["objects", id, "findings", findingId] as const,
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
  users: {
    all: ["admin", "users"] as const,
  },
  admin: {
    objects: ["admin", "objects"] as const,
    documents: (filters: {
      objectId?: string;
      page?: number;
      q?: string;
      userId?: string;
    }) => ["admin", "documents", filters] as const,
    documentStats: (range: string) =>
      ["admin", "documents", "stats", range] as const,
    parse: (fileId: string, artifactId: string) =>
      ["admin", "documents", "parse", fileId, artifactId] as const,
    renderedPage: (fileId: string, artifactId: string, page: number) =>
      [
        "admin",
        "documents",
        "parse",
        fileId,
        artifactId,
        "page",
        page,
      ] as const,
  },
} as const;
