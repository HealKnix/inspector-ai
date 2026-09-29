import { clarificationBatchSchema } from "@/api/types/identification";
import { parseResult } from "@/api/types/parsing-test-fixtures";
import { idRegistry } from "@/pages/identification/lib/identification-test-fixtures";
import {
  applyIdentification,
  getIdentification,
  getIdentificationDocument,
  getIdentificationEvidence,
} from "./identification";

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/api/client", () => ({ apiClient: { get, post } }));
beforeEach(() => vi.resetAllMocks());

it("pins the requested run and rejects a different snapshot", async () => {
  get.mockResolvedValue({ data: idRegistry });
  const signal = new AbortController().signal;
  await getIdentification(idRegistry.process_id, idRegistry.run_id, signal);
  expect(get).toHaveBeenCalledWith(
    `/v1/processes/${idRegistry.process_id}/documents`,
    { params: { run_id: idRegistry.run_id }, signal },
  );
  await expect(
    getIdentification(
      idRegistry.process_id,
      "33333333-3333-4333-8333-333333333333",
    ),
  ).rejects.toMatchObject({ status: 409 });
});
it("pins list and card history to an exact hash within the same run", async () => {
  const hash = idRegistry.resolved_input_hash!;
  const signal = new AbortController().signal;
  const document = idRegistry.documents[0]!;
  get.mockResolvedValue({ data: { ...idRegistry, document, history: [] } });
  await getIdentification(
    idRegistry.process_id,
    idRegistry.run_id,
    signal,
    hash,
  );
  await getIdentificationDocument(
    idRegistry.process_id,
    idRegistry.run_id,
    document.document_id,
    signal,
    hash,
  );
  expect(get).toHaveBeenNthCalledWith(
    1,
    `/v1/processes/${idRegistry.process_id}/documents`,
    {
      params: { run_id: idRegistry.run_id, resolved_input_hash: hash },
      signal,
    },
  );
  expect(get).toHaveBeenNthCalledWith(
    2,
    `/v1/processes/${idRegistry.process_id}/documents/${document.document_id}`,
    {
      params: { run_id: idRegistry.run_id, resolved_input_hash: hash },
      signal,
    },
  );
  get.mockResolvedValue({
    data: {
      ...idRegistry,
      resolved_input_hash: "e".repeat(64),
      document,
      history: [],
    },
  });
  await expect(
    getIdentification(idRegistry.process_id, idRegistry.run_id, signal, hash),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    getIdentificationDocument(
      idRegistry.process_id,
      idRegistry.run_id,
      document.document_id,
      signal,
      hash,
    ),
  ).rejects.toMatchObject({ status: 409 });
});
it("reads evidence with immutable artifact/run coordinates and rejects a swapped original", async () => {
  const evidence =
    idRegistry.documents[0]!.revisions[0]!.candidates[0]!.evidence[0]!;
  get.mockResolvedValue({ data: parseResult });
  await getIdentificationEvidence(
    idRegistry.object_id,
    idRegistry.run_id,
    evidence,
  );
  expect(get).toHaveBeenCalledWith(
    expect.stringContaining(`/files/${evidence.file_id}/parse`),
    {
      params: { artifact_id: evidence.artifact_id, run_id: idRegistry.run_id },
      signal: undefined,
    },
  );
  get.mockResolvedValue({
    data: {
      ...parseResult,
      artifact: { ...parseResult.artifact, source_sha256: "f".repeat(64) },
    },
  });
  await expect(
    getIdentificationEvidence(
      idRegistry.object_id,
      idRegistry.run_id,
      evidence,
    ),
  ).rejects.toMatchObject({ status: 409 });
});
it("submits one versioned batch and validates its receipt, including deferred parsing", async () => {
  const body = {
    request_id: "44444444-4444-4444-8444-444444444444",
    expected_run_id: idRegistry.run_id,
    basis: " Проверено по оригиналу ",
    documents: [
      {
        document_id: idRegistry.documents[0]!.document_id,
        expected_version: 1,
        revisions: [
          {
            revision_id: idRegistry.documents[0]!.revisions[0]!.revision_id,
            fields: { number: "53" },
          },
        ],
      },
    ],
  };
  post.mockResolvedValue({
    data: {
      schema_version: 1,
      request_id: body.request_id,
      process_id: idRegistry.process_id,
      previous_run_id: idRegistry.run_id,
      run_id: "55555555-5555-4555-8555-555555555555",
      resolved_input_hash: null,
      replayed: false,
    },
  });
  expect(
    (await applyIdentification(idRegistry.process_id, body))
      .resolved_input_hash,
  ).toBeNull();
  expect(post).toHaveBeenCalledWith(
    expect.stringContaining("/document-resolutions"),
    { ...body, basis: "Проверено по оригиналу" },
  );
  await expect(
    applyIdentification(idRegistry.process_id, {
      ...body,
      request_id: "66666666-6666-4666-8666-666666666666",
    }),
  ).rejects.toMatchObject({ status: 409 });
});

it("preserves sheet decisions and complete resolved provenance in registry responses", async () => {
  const registry = structuredClone(idRegistry);
  const document = registry.documents[0]!;
  const revision = document.revisions[0]!;
  const representation = revision.representations[0]!;
  representation.format = "PDF";
  representation.page_count = 2;
  revision.sheet_map = {
    file_id: representation.file_id,
    source_sha256: representation.source_sha256,
    sheets: [{ label: "01", page_number: 2 }],
    excluded_pages: [1],
    basis: "Синтетическая карта",
  };
  revision.sheet_replacement = {
    predecessor_revision_id: "33333333-3333-4333-8333-333333333333",
    replaced_labels: ["01"],
    basis: "Синтетическое разрешение",
  };
  registry.contexts = [
    {
      context_id: "synthetic",
      scope: "A",
      works_period: { from: null, to: null },
      actual: {
        document_id: document.document_id,
        revision_id: revision.revision_id,
      },
      reference: null,
      status: "CLARIFICATION_REQUIRED",
      blockers: ["works_period_unresolved"],
      sheet_selection: {
        reference: null,
        actual: {
          selection_hash: "d".repeat(64),
          chain: [
            {
              revision_id: revision.revision_id,
              decision_hash: "e".repeat(64),
            },
          ],
          sheets: [
            {
              label: "01",
              page_number: 2,
              document_id: document.document_id,
              revision_id: revision.revision_id,
              file_id: representation.file_id,
              artifact_id: representation.artifact_id,
              artifact_sha256: representation.artifact_sha256,
              source_sha256: representation.source_sha256,
            },
          ],
        },
      },
    },
  ];
  get.mockResolvedValue({ data: registry });
  expect(await getIdentification(registry.process_id, registry.run_id)).toEqual(
    registry,
  );
});

it("keeps nullable removals explicit and rejects duplicate physical pages before sending a sheet decision", () => {
  const body = {
    request_id: "44444444-4444-4444-8444-444444444444",
    expected_run_id: idRegistry.run_id,
    basis: "Синтетическое уточнение",
    documents: [
      {
        document_id: idRegistry.documents[0]!.document_id,
        expected_version: 1,
        revisions: [
          {
            revision_id: idRegistry.documents[0]!.revisions[0]!.revision_id,
            sheet_map: null,
            sheet_replacement: null,
          },
        ],
      },
    ],
  };
  expect(clarificationBatchSchema.parse(body)).toEqual(body);
  const representation =
    idRegistry.documents[0]!.revisions[0]!.representations[0]!;
  const invalid = {
    ...body,
    documents: body.documents.map((document) => ({
      ...document,
      revisions: document.revisions.map((revision) => ({
        ...revision,
        sheet_map: {
          file_id: representation.file_id,
          source_sha256: representation.source_sha256,
          sheets: [{ label: "1", page_number: 1 }],
          excluded_pages: [1],
          basis: "Синтетическая карта",
        },
      })),
    })),
  };
  expect(clarificationBatchSchema.safeParse(invalid).success).toBe(false);
});
