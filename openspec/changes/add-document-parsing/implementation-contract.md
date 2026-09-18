# PAR implementation contract, version 1

Owner decision, 2026-09-18: while parsing the current Run, Process is PARSING;
after all its file tasks have a durable outcome it returns to PENDING. This
includes technical failure. File outcomes remain visible. READY still belongs
exclusively to saved protocols. A retry uses the existing original, without a
duplicate upload; a better scan is a new immutable original and a new Run under
the existing upload contract. No original is overwritten or silently replaced.
Accepting new files into a process in an upload-allowed state atomically creates
the new current Run and sets Process to PENDING. A prior Run's READY or terminal
state cannot describe the newly accepted inputs; parsing then starts normally.

## Internal parser boundary

The local Python service reads only UUID handles from STORAGE_ROOT/originals and
writes derived UUID handles under STORAGE_ROOT/derived. It never accesses the
domain database. Network access to it is private; requests use PARSER_TOKEN.
Models must be available locally before readiness; documents never leave the
deployment. The application validates the response, its input hash, version and
lease before publishing any result.

- GET /health: {status: "ok", pipeline_fingerprint: string, versions: object}.
- POST /parse, Authorization: Bearer <PARSER_TOKEN>:
  {schema_version: 1, request_id: UUID, storage_key: UUID, source_sha256: hex64,
  format: "pdf" | "docx" | "xml"}.
- Response: ParseArtifact below. Non-2xx errors use {code, retryable}; no document
  text, source path or raw exception is returned in an error.
- GET /progress/:request_id (same authentication): {pages_completed: integer,
  pages_total: integer|null, stage: string}. Progress is informational; durable
  publication and attempt accounting belong to the backend.
- POST /cancel/:request_id (same authentication): {cancelled: boolean}; true
  means the CPU worker has terminated. A busy parser has not admitted the file:
  backend defers it with backoff without consuming an OCR attempt.

ParseArtifact:

```typescript
{
  schema_version: 1;
  source_sha256: string;
  pipeline_fingerprint: string;
  versions: Record<string, string>;
  raw_text: string;
  normalized_text: string;
  quality: "OK" | "LOW_QUALITY" | "ABSTAIN";
  reasons: string[];
  coverage: { total_pages: number; readable_pages: number; unreadable_pages: number };
  pages: Array<{
    page_number: number; // physical, one-based
    sheet_label: string | null;
    width: number;
    height: number;
    image_key: string; // derived UUID, PNG
    image_sha256: string;
    quality: "OK" | "LOW_QUALITY" | "ABSTAIN";
    reasons: string[];
    transform: Record<string, unknown>;
    blocks: Array<{
      id: string;
      order: number;
      kind: "text" | "table_cell";
      raw_text: string;
      normalized_text: string;
      bbox: [number, number, number, number]; // x0,y0,x1,y1 in visible page [0,1]
      confidence: number | null;
      source: "native" | "ocr" | "structured";
      structural_path: string | null;
      table_id: string | null;
      row: number | null;
      column: number | null;
      row_span: number | null;
      column_span: number | null;
    }>;
  }>;
}
```

Quality is extraction quality, never a finding or a claim of document compliance.
Model confidence is not measured accuracy. Missing areas and unsupported layout
must remain explicit. Normalization preserves signs and letters; it does not
correct OCR guesses. Transform metadata describes the exact rendered page.
Page width/height equal PNG pixel dimensions and transform.render_width/height.
For PDF, pdf_to_visible/visible_to_pdf matrices operate in PDF/visible **points**;
visible_width_points/visible_height_points convert those points to block [0,1]
coordinates. pdf_to_normalized/normalized_to_pdf explicitly include that scaling.
OCR orientation is inverted before publishing blocks; the displayed page retains
the source's visible orientation. Structural views identify their renderer and
do not pretend to reproduce Microsoft Word pagination.

## Public read and retry API

All paths below are under /api/v1. Existing object access and session checks apply.

- GET /objects/:objectId/parsing returns
  {schema_version: 1, active: boolean, poll_after_ms: 2000, items: ParsingFile[]}.
  Items describe the latest Run of each Process, not stale historical runs.
- ParsingFile: {file_id, process_id, run_id, original_name,
  state: "queued"|"processing"|"succeeded"|"failed", attempt: number,
  pages_completed: number, pages_total: number|null,
  quality: "OK"|"LOW_QUALITY"|"ABSTAIN"|null, reasons: string[],
  error_code: string|null, can_retry: boolean, artifact_id: string|null}.
  These are technical task states, not additional ProcessStatus values.
- GET /objects/:objectId/files/:fileId/parse returns
  {artifact_id: UUID, file_id: UUID, run_id: UUID, artifact: ParseArtifact}.
  409 means no published result for the current Run. It must not substitute an
  artifact belonging to another Run or another object.
- GET /objects/:objectId/files/:fileId/parse/pages/:pageNumber returns image/png
  from that published artifact, with private,no-store cache policy.
  Optional artifact_id query pins the exact artifact whose blocks are displayed;
  a changed artifact returns 409. The response includes X-Artifact-Id.
- POST /objects/:objectId/files/:fileId/parse/retry with JSON
  {request_id: UUID} returns 202. Inspector + explicit object access, current Run
  only, no active file job, immutable original hash verified. The request_id makes
  retries of this HTTP operation idempotent. A deliberate retry is a new bounded
  execution cycle; automatic message redelivery never resets its three attempts.

## Durability and deployment

Keep the existing Run-level Job/outbox event as the idempotent fan-out parent.
Add per-file execution records rather than destroying historical jobs/receipts.
Backfill pending current Runs so files uploaded before PAR installation are picked
up. RabbitMQ carries work; Postgres owns execution leases, outcomes and artifact
links. A late worker cannot publish after losing its lease/current Run. Ack follows
the durable commit. Reusable artifacts require matching source hash and complete
pipeline fingerprint; Redis is optional acceleration, never the only copy.

The root change owner manages this contract, Compose and evidence. Backend owns
Prisma/HTTP/queue validation; parser owns Python extraction/rendering/tests;
frontend owns polling/viewer with runtime response validation.
