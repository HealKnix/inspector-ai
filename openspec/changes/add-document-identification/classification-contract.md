# Classification implementation contract v1

Owner decision, 18 September 2026: implement rules-first PD/RD/ID classification
after parsing, with an OpenAI-compatible LLM reading bounded title and metadata
fragments when rules do not resolve the document. The first provider is OpenRouter,
model `qwen/qwen3.8-27b`; the model and base URL are configuration, not code branches.
Ollama uses the same Chat Completions adapter with its own base URL and model name.

This is the classification slice of ID. Existing obligations for full logical
Document/Revision/Part resolution, applicability, signatures and immutable human
clarifications remain open. A file with conflicting own stages is explicitly
unresolved; this slice does not silently assign one stage to a mixed bundle.

## Processing

The existing immutable ParseArtifact supplies raw/normalized blocks, structural
paths and physical-page locators. Known XML QNames/paths and explicit own titles
are the initial rules. Reference sections, filename codes and folder names cannot
override own evidence. Repeated OCR/table readings do not create independent proof.
Bounded fragments include title candidates and surrounding blocks; the full file,
images and original filename are not sent to the LLM.

The LLM returns JSON with stage, document kind and evidence referring to supplied
blocks. Every reference and verbatim quotation is validated. Model confidence is
not a calibrated acceptance probability. Initially model suggestions carry
`needs_review=true`; strong contradictions remain unresolved. Missing evidence,
disabled LLM and provider errors remain visible. No alternative external endpoint
is contacted automatically. Input text is untrusted content, not instructions.

ClassificationTask belongs to ID and references ParseArtifact. Each attempt is
leased; each deliberate retry creates a new cycle. A changed classifier fingerprint
offers an explicit retry, including for queued tasks from an earlier configuration;
workers never overwrite another configuration's tasks. PostgreSQL owns results and the transactional outbox; RabbitMQ carries only
task IDs. A recovery scan schedules already published current artifacts and repairs
lost deliveries. Publication checks lease, current Run, latest parser cycle,
latest classification cycle and source integrity. Classification does not change
ProcessStatus and never produces READY.

## API

- GET `/api/v1/objects/:objectId/classification`: current published artifacts with
  task state, result, error code and retry availability; `active` drives polling.
- POST `/api/v1/objects/:objectId/files/:fileId/classification/retry` with
  `{request_id: UUID}`: idempotently creates a new classification cycle without OCR.
- Both operations require an active inspector session and assignment to the object.
  Retry requires PENDING/PARSING and a current intact published parser result.
  Audit contains IDs/versions, not source text or API secrets.

Result v1 contains stage (`PD`, `RD`, `ID`, or null), document_kind, method,
needs_review, reason codes, candidates, evidence (page/block/quote/bbox/path), and
classifier/rules/context/prompt/model versions. UI distinguishes machine proposal,
uncertainty and technical failure and opens evidence only against the matching
artifact. Actual classification accuracy requires separate corpus calibration.

## Configuration

Server-only `CLASSIFICATION_LLM_*` settings select enabled mode, base URL, model,
API key, response format, timeout and response size limits. Disabled is the safe
installation default. Enabling OpenRouter explicitly permits sending the selected
text to that configured provider. Ollama may omit a key. HTTP redirects are rejected.
Keys and provider response bodies are never logged or returned to the browser.

Sources: https://developers.openai.com/api/reference/resources/chat,
https://docs.ollama.com/api/openai-compatibility,
https://openrouter.ai/docs/guides/features/structured-outputs,
https://openrouter.ai/qwen/qwen3.8-27b (checked 18 September 2026).
