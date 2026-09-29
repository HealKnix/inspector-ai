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
  region_schema_version?: 1; // regional PDF only; absent for legacy/DOCX/XML
  text_provenance_schema_version?: 1; // new PDF fusion profile; absent for legacy/DOCX/XML
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
    regions?: Array<{ // required on every page when region_schema_version=1
      id: string; // unique across the artifact
      kind: "text" | "table" | "graphic" | "unknown";
      bbox: [number, number, number, number]; // same visible [0,1] page space
      raw_class: string | null;
      raw_score: number | null; // original Paddle confidence, not accuracy
      method: "native" | "ocr" | "hybrid" | "native_table" | "table_ocr" | "skipped";
      reasons: string[];
      table_status: "not_applicable" | "structured" | "unconfirmed" | "unreadable";
    }>;
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
      region_id?: string; // required in regional PDF, same-page region
      include_in_main?: boolean; // required in regional PDF; never evidence eligibility
      native_valid?: boolean; // actual native Unicode/geometry check; absent is unknown
      provenance?: {
        schema_version: 1;
        status: "selected" | "ambiguous";
        method: "native" | "ocr" | "hybrid";
        fragments: Array<{
          source: "native" | "ocr";
          raw_text: string;
          bbox: [number, number, number, number]; // original visible-page coordinates
          native_valid: boolean | null; // null for OCR, never a fabricated legacy result
          role: "selected" | "alternative";
        }>;
        reasons: string[];
      };
      table_link?: { // original text crossing columns can remain one unsplit block
        schema_version: 1;
        status: "associated" | "ambiguous";
        table_id: string | null; // null if a unique displayed table cannot be established
        rows: number[];
        columns: number[];
        reasons: string[];
      };
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

### Native/OCR fusion extension, 27 September 2026

The new profile declares `parser=par-local-2`,
`pdf_region_profile=paddle-regions-v2`,
`table_detector=pp-structure-v3-guarded-v2` and
`text_provenance=par-text-provenance-v1`. New PDF artifacts carry both schema
markers. DOCX/XML keep their existing structural route; the common versions map
does not require PDF markers on them. Legacy artifacts remain readable without
inventing native validity or fragment provenance. Source and configuration hashes
are part of the pipeline fingerprint, so incompatible Redis/cache/checkpoints
cannot become results of the new profile.

Suitable native text has priority over a conflicting OCR reading of the same
location. Raw candidates and original coordinates remain available; conflict is
never resolved by concatenating both readings. Uncertain selection is explicit
and is not eligible as a verified fact merely because a model supplied a score.
Table structure and text selection have separate evidence: a table model label
does not assert that the selected characters came from OCR.
Every nonempty new-profile block must carry provenance; a genuine empty table
cell may omit it. Its method reflects the sources of all retained fragments,
including alternatives, while selected roles identify the chosen reading.
Backend, frontend and OpenAPI reject a method that contradicts those sources.

Cross-column text is not split into invented words or assigned to one column by
its centre. A table link can preserve the original block and an established row
association. Rows/columns are zero-based, unique and nonempty. An associated link
must reference actual cells of the same displayed table on the same page. When
the original grid is separated into overlapping display parts, an unresolved or
multiple target becomes an ambiguous link with `table_id=null` and a reason.
This ambiguity does not erase the underlying native text.

ID/EXT share the PAR eligibility selector. Hidden native fragments from a
`skipped` region can be read only when `native_valid=true`; they retain their
original region and locator. The viewer's `include_in_main` selection is not
changed. Native source blocks hidden behind a reconstructed table are not added
again as duplicate evidence. Legacy hidden native without an explicit validity
check is not assumed suitable. `DUPLICATE_NATIVE_READING` marks the suppressed
duplicate and is also excluded from analysis; the retained primary uses
`NATIVE_DUPLICATE_ALTERNATIVE_RETAINED`. Conflicting native readings stay
ambiguous even if OCR happens to agree with one of them. OCR of
`graphic`/`unknown` remains forbidden.

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

### Execution progress extension, 18 September 2026

The additive public ParsingFile fields are nullable (old responses may omit them):
`phase`, `progress_updated_at`, `waiting_reason`, `retry_at`,
`checkpoint_validated`, `checkpoint_pages`, `current_page`,
`previous_attempt_error`, `progress_reset_reason`.
`retry_at` comes from the durable queue schedule, not a browser countdown.
These fields do not add business ProcessStatus values or change artifact schema.

Phases: checking_parser, waiting_models, waiting_capacity, starting,
checkpoint_verifying, resuming, rendering, layout, extracting, ocr,
publishing, retry_delay. The layout phase covers Paddle region detection before
selective extraction; extracting/ocr then describe work within allowed regions.
Waiting reasons: models_not_ready, parser_busy, retry_backoff.
Reset reasons: pipeline_version_changed or saved_pages_unavailable.

Claim/readiness preserve the last confirmed page counts. Python first verifies
all checkpoints, including metadata/image hashes and physical page numbers,
then reports the verified count, even if lower than the preceding attempt.
Later progress within that execution cannot go backwards. The timestamp changes
when actual progress/stage changes, not for repeated polls of one snapshot.
Progress from Python includes the exact request_id and pipeline_fingerprint;
backend additionally checks the lease, cycle and current Run before applying it.

Continuous models_not_ready has a durable deadline, default 300 seconds
(`PARSER_MODEL_READY_WAIT_SECONDS`, configurable 30–1800). Health success alone
does not clear it. Matching progress, accepted parse result/error or a confirmed
cancel of that request establish admission and end the waiting episode.
Pre-admission deferrals do not consume the three actual parsing attempts.
Expiry saves models_not_ready_timeout, one terminal event and the manual retry
action; restarts and redelivery do not extend the deadline. parser_busy retains
its own capacity policy. The existing PARSING → PENDING rule is unchanged.

### Regional PDF extension, owner-authorized after the layout experiment

The [31-image experiment](../../../docs/adaptive-layout-experiment.md) failed
the table/caption separation conditions. The owner subsequently requested
implementing the regional route and improving recognition quality later. This
authorizes the [regional plan](adaptive-ocr-plan.md) despite those measured
limitations; it does not turn the experiment into a quality pass. VLM remains
excluded. The region viewer exposes the selected boundaries and explanations.

`region_schema_version: 1` is an additive extension of PAR schema 1, used only
for PDFs. The original `versions.pdf_region_profile = "paddle-regions-v1"`
and the current `paddle-regions-v2` identify the processing profiles and
contribute, with code/configuration, to the complete
fingerprint. DOCX/XML may carry the globally configured PDF profile in versions
but retain their existing non-regional result. New-profile PDF results cannot
omit the marker; markers and incomplete links cannot be bypassed by stored reads.
Legacy PDFs without that profile and marker remain readable with no invented
regions. Current cache reuse still requires the exact source hash/fingerprint.

Every regional page has `regions` (including an empty array when applicable).
Each block has a valid same-page `region_id` and boolean `include_in_main`.
Region IDs are unique across the artifact; limits are 10,000 regions per page,
100,000 per artifact, and the existing 64 MiB artifact bound. Coordinates and
scores are finite; region boxes use the same original visible page space as
blocks. Whole native glyphs can cross a region edge, so validation does not clip
or reject a native block merely for exceeding its region box.

Text methods are native/ocr/hybrid. Table methods are native_table/table_ocr/hybrid;
partly covered tables can retain native text and OCR only missing content.
Graphic/unknown regions always use skipped with at least one explicit reason;
their blocks are native text only and `include_in_main=false`. OCR is invalid
in such regions. Native/native_table methods also forbid OCR blocks. OCR-only
methods can retain invalid native text for audit with `include_in_main=false`.
Excluded native duplicates alongside reconstructed cells also remain in the
full result. `include_in_main=true` is allowed only in text/table regions; it is
a presentation filter, never approval of a fact for the control matrix.

Non-table regions use table_status=not_applicable. Structured tables require
actual table_cell blocks, including legitimate empty cells. Unconfirmed or
unreadable tables retain an explanation and available plain text, without
invented cells. A table ID cannot span different regions on one page. Regional
table grids must remain valid in both fresh and stored reads. Whitespace-only
OCR text blocks are rejected; empty real table cells are preserved.

`raw_text` and `normalized_text` preserve the existing full extraction meaning,
including retained native labels in graphic/unknown regions and cell alternatives.
The API never drops excluded blocks or rewrites full text during validation.
Coverage continues to count pages with nonempty extracted normalized text,
including excluded native labels. A deliberately skipped graphic-only page may
have quality OK and zero textual coverage: coverage is not a quality verdict.

The owner-selected OCR pipeline is PP-StructureV3 with mobile1536 detection,
the Russian eslav recognizer and nine pinned local models. It keeps overall OCR
lines alongside plain table-cell data; independent readings may differ and repeat.
Table HTML is never served as executable markup. Grid/geometry validation may
reject structure while preserving text and explicit quality reasons. Table OCR
alternatives without inverse-mapped line polygons use the enclosing-table locator.
Stored legacy artifacts remain readable; new results and cache candidates pass
strict validation. The published versions include the actual OCR engine/profile
and configuration digest; the full configuration contributes to the fingerprint.

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
