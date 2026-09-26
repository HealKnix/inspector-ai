# Identification and revision selection v1

Implementation scope approved by the owner on 25 September 2026. This extends
the existing classification slice; it does not close all original ID obligations.

## Scope and decisions

- Whole logical documents, revisions and PDF/XML representations. Mixed bundles,
  partial sheet replacement and visual signature verification remain unsupported
  and explicitly prevent automatic comparison.
- Own XML fields use complete namespace-qualified paths. References and attachment
  metadata never replace the document's own fields. `edition` and `Signed` are
  observed evidence, not inferred project approval.
- Unambiguous deterministic field evidence can be accepted; LLM proposals require
  review. Approval, replacement and effective dates require an inspector's basis
  until a separately validated recognition policy exists.
- Automatic representation matching requires complete matching own identity,
  scope and work period and no conflicting recognized metadata. A missing field
  does not act as a wildcard. Files and original hashes are immutable.
- An ID document selects the approved RD revision applicable to its work period
  using its own reference and confirmed scope. There is no automatic PD fallback.
  Other reference pairs require an explicit supported reference or an inspector's
  selection. Upload time and maximum revision number are not selection rules.
- Missing dates, approval, scope, unsupported parts or conflicting replacements
  remain clarification reasons, never violations or negative verified results.

## Persistence and processing

ID owns Document, DocumentRevision, FileDocumentPart, FieldCandidate and
append-only Clarification. Raw machine evidence remains separate from decisions.
A card version is not an original document revision. The original File and
ParseArtifact are preserved.

The limited INC bridge owns immutable ResolvedInputSnapshot records tied to a
Run and its original InputManifest. They freeze documents, selected revisions,
representations, decisions, policies and comparison contexts. New snapshots never
rewrite old snapshots. A dependency graph and incremental scheduling are deferred.

`Apply and recalculate` atomically checks current Run/card versions, assignment,
process state and active work; saves decisions; creates a new Run on the same
originals; and registers Job/Outbox. The process_id stays stable. Retries use a
request receipt and payload fingerprint. Existing PAR cache is reused through
new current-Run tasks/artifact records, without bypassing fencing.

Application is permitted for assigned inspectors in PENDING, READY, VERIFYING
and COMPLETED when no processing is active. PARSING and FINALIZED reject writes.
Classification retry cannot erase a human decision. The old manual kind endpoint
uses the same clarification service and cannot bypass version/basis validation.

## Consumer boundary

COM counts logical documents instead of formats. EXT/CMP use a pinned snapshot
and comparison context (reference/actual revisions, scope and work period), not
all PD files against all RD/ID files. Unresolved contexts block only dependent
comparisons. Several contexts of one parameter remain separate findings.

Evidence groups are append-only per Run/snapshot/context/content. Findings freeze
members and locators; historical reads do not consult a mutable current group.
Protocol reuse and decision carry-forward require the same complete semantic
basis, including source revisions, rule, scope and evidence. Finalized and old
protocols remain readable. A new Run makes the old protocol historical and requires
explicit protocol generation after processing.

## API and UI

- GET `/api/v1/processes/:processId/documents?run_id=...`
- GET `/api/v1/processes/:processId/documents/:documentId?run_id=...`
- POST `/api/v1/processes/:processId/document-resolutions`, with request_id,
  expected_run_id, expected card versions and a basis for each decision.

Responses include actual Run, snapshot, card versions and allowed actions.
Historical reads are explicit. Evidence always resolves against its exact
artifact/hash. Stale mutation returns 409; an identical replay returns the original
response. The UI keeps process/Run/document in its URL and uses the existing viewer.

## Acceptance and rollout

Owner clarification 2026-09-26: the inspector-facing screen presents a compact,
type-specific card beside the original. Normal comparison source selection is
automatic under the existing policy; only an actionable ambiguity asks for an
inspector decision. Technical identifiers, diagnostics and detailed history do
not occupy the main form. One primary action confirms displayed non-empty values
or applies corrections using the existing clarification transaction. Confirmation
of unchanged values also creates a new Run with its basis and author; it does not
implicitly confirm approval, hidden fields or a reference. No separate no-recompute
review state is introduced. Unsupported-source limitations and permissions remain.

Additive migrations never recalculate historical data. Old manual classifications
without a basis cannot prove approval or replacement. Unrecoverable legacy
evidence is explicitly unavailable; current evidence is not substituted.

Acceptance covers own vs referenced metadata (AOSR 52), two representations of
one act, old revision uploaded last, two work periods selecting different RD
revisions, unsupported/missing/conflicting inputs, optimistic concurrency,
idempotency, stale workers, immutable history, finalized reload, and reuse of OCR
cache. Tests use an isolated PostgreSQL/RabbitMQ environment. Full ID, all 132
rules, visual signatures, partial sheets and quantitative C24 acceptance remain open.
