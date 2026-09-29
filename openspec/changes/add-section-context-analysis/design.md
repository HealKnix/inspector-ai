## Context

See proposal.md. The current tree already includes uncommitted sheet-selection, exact-number, matrix-release, parser-provenance and verification changes. Preserve these. Codex owns this design and reviews the delta; Devin SWE-2 Max implements code and tests. `tmp/section-context-20260928/baseline` in the parent workspace records the starting files for review.

Existing seams are `analysisBlocks`, `selectedArtifactView`, `IdentificationSnapshot.contexts`, the extraction worker/outbox, `ClassificationConfig`, `MatrixRow`, and `VerificationService`/`buildProtocol`. A separate per-parameter regex plan is not a prerequisite of this feature.

## Goals / Non-Goals

**Goals:** an executable and testable path from stored PAR artifacts through section discovery and batched matrix analysis to frozen inspector evidence and normal inspector decisions. Retrieval is economical and preserves provenance and uncertainty.

**Non-Goals:** replacing OCR, geometry or exact arithmetic; changing document approval or access roles; claiming expert acceptance of all 132 rows. Ordinary tests use synthetic documents and mocked HTTP, not paid provider calls or hidden evaluation material.

## Decisions

### D1. Source selection precedes all LLM work

Only explicit READY comparison contexts from the current resolved-input snapshot may supply paired sources. Apply selectedArtifactView where a resolved sheet set exists; unresolved sheet maps, revision blockers and stale representations prevent comparison. Apply analysisBlocks to each selected page. Preserve artifact/source hashes, physical pages, document/revision identifiers, selection hashes, scope and period. Never pass artifact.raw_text as a shortcut. The model cannot change these bindings.

### D2. Compact discovery and reusable section index

Pure candidate discovery uses heading numbering, short title-like text, structural paths, TOC entries and page positions; recurring headers/stamps are excluded from candidate ranking, not silently removed from section bodies. Candidate records include real boundary block IDs, nearby snippets and possible terminal block IDs, within an explicit byte budget. The first LLM request receives this compact manifest and returns strict JSON titles, start/end IDs, relevant parameter codes and missing-context requests. A bounded second pass can expand around requested candidate anchors. Unknown/reversed/foreign/unsupported endpoints are rejected. Failure to determine a boundary is explicit, never a whole-document fallback.

Cache validated section boundaries by source/artifact content, selected-sheet identity, parser pipeline, candidate/prompt/model configuration and relevant matrix input. Bind fresh run IDs outside the semantic cache key. Reuse the index across requested parameters and retries; never recompute discovery independently for each row.

### D3. Full context, bounded calls, explicit coverage

Collect the entire inclusive range server-side with table cells, row/column/span, captions and notes. Each outgoing source block includes its immutable source reference and block ID. Bound candidate bytes, request bytes, response bytes, parameters per batch, total calls and timeout. Large sections split on complete blocks/table groups, retaining provenance and coverage. Process all required chunks and reconcile their findings; no first-N prefix can be reported as a complete check. If a single group or total work exceeds the configured bound, retain partial coverage and return an explicit missing-context result for affected rows. Cross-chunk comparison must preserve both sides and cannot infer agreement from disjoint windows.

Coverage is also published per parameter as an additive `SectionParameterResult.coverage` field. New engine outputs always populate it; readers fall back to context coverage only for older outputs. Context coverage remains the aggregate summary. A missing unrelated parameter must not erase a fully covered fact: row-specific missing sections, omitted chunks, analysis failures and reconciliation gaps affect their owning parameter codes. Shared source/discovery uncertainty still affects every relevant row conservatively. Mixed pages with readable text but unresolved table/unknown regions count as missing coverage. The discovery prompt reserves its unscoped missing-context field for shared uncertainty; absence of a matching section is represented by no section for that parameter. Frozen finding coverage is the effective parameter coverage, and its semantic fingerprint includes that coverage.

### D4. Facts are independent of regex plans

Pin the real MatrixImport and MatrixRow payload (code/name/source hints/trigger/unit) at admission, using a Run's release catalog when pinned. Batch multiple relevant rows on the same matched sections within one comparison context. Do not fabricate a RuleVersion/regex to pass old has_rule gates. Preserve approved deterministic numerical/composite checks; the LLM contributes preliminary facts and cannot override an exact numerical verdict.

The strict result covers each requested parameter exactly once. A result contains an assessment (potential difference, proposed agreement, insufficient context), fact text, evidence [{source_ref, block_id, quote}], missing_context and question_for_inspector; multiple atomic observations can remain inside one parameter/context result. Quotes must be nonempty exact substrings of the blocks actually sent, not arbitrary blocks elsewhere in the artifact. Server derives all page/bbox/table locators. Missing, extra or duplicate codes, invented evidence and invalid schemas reject the response. Persist prompt/model/config/matrix versions and request coverage, not private reasoning.

Comparative `potential_difference` and `proposed_agreement` require verified evidence from BOTH reference and actual roles. Coverage includes discovery omissions, boundary uncertainty and all required chunk/reconciliation work. Fully reading one found range does not erase omitted discovery candidates. A section range is always within one artifact; composed sheet sets can bind several distinct ranges.

### D5. Explicit provider mode

Section analysis has its own validated enable flag, off by default, while reusing the established server-side provider configuration (or an explicitly documented section-specific override). A configured classification model alone does not enable sending complete sections. OpenRouter uses strict response_format json_schema and provider.require_parameters=true; other explicitly configured compatible local endpoints retain strict server validation. Bound response reads/timeouts, reject incomplete completion, tool calls and refusals, and never log source text or credentials. Documents are untrusted data with no authority to invoke tools.

### D6. Durable execution within existing backend

Add immutable section-index cache and a run-bound SectionAnalysisTask/result record with unique input/config fingerprint, matrix pin, resolved-input hash, source manifest, attempts, availability, lease token/until and technical error. Technical job states follow existing queued/processing/succeeded/failed conventions. Start via an authenticated object-scoped POST and poll via GET; no LLM call runs inside an HTTP transaction. Use existing extraction worker and outbox routing for the new event type; recovery covers lost dispatch and expired leases, attempts are bounded and final failures are visible. Execute external work outside transactions. Publish only after object/process locks, current run and source fingerprint checks, finalization checks and matching lease/config fingerprints. Repeated delivery/admission is idempotent. Changes of matrix, parser, selection, model or prompt invalidate reuse appropriately.

The latest newly admitted request selects the one current section-analysis basis for a run; GET and protocol generation must select that same task. Reusing a previously completed semantic task under a new request ID may select it again without another provider call. Replaying an old request ID only returns its receipt and must not reactivate it over a newer request. A request for a different parameter subset replaces the current section-analysis basis rather than silently unioning conflicting historical outputs. Older records remain available for frozen protocol history. Persist this selection explicitly or with an equivalent unambiguous admission order, rather than relying only on task creation time.

### D7. Existing verification and evidence navigation

Extend buildProtocol with an explicit section-result input rather than pretending a section fact is a scalar Extraction. Persist its fact/question/missing-context/coverage and server-derived sources in Finding.evidenceSnapshot.section_analysis with a versioned section-analysis payload. Expose section_analysis as an additive top-level field of serialized findings, derived from this frozen snapshot. Keep the existing scalar verdict intact (nullable for section-only findings), rather than manufacturing a scalar verdict. EvidenceGroup IDs remain null where no scalar group exists. Do not invent extraction or rule IDs. Group identity remains parameter plus resolved comparison context; preserve deterministic results and avoid uniqueness collisions (merge an advisory payload where an existing scalar finding has the same identity).

Generate waits for a requested section task to finish and rejects stale results; it does not require section mode when disabled or never requested. Completed grounded facts become reviewable CANDIDATEs, including a proposed agreement which is explicitly labelled preliminary. Incomplete inputs use existing MISSING_EVIDENCE/NOT_COMPARABLE outcomes with concrete reasons. LLM never sets CONFIRMED_VIOLATION or NEGATIVE_VERIFIED. Existing completeness/applicability/source gates and human decision permissions remain in force. The section path provides its own matrix-bound analysis basis, not approval of an old regex rule.

Semantic fingerprints and frozen protocol content include facts, questions, missing_context, coverage, section bounds, citations and prompt/model/matrix basis, plus the admitted task/result fingerprint. Changed meaning invalidates decision carryover. Decision and finalization checks reject current section results that no longer match the protocol snapshot, including a pending replacement analysis on unchanged sources. Old findings without section data remain readable. Historical names/trigger/unit for section findings come from their frozen matrix basis, not the newest import.

Priority is explicit: a fully executed applicable exact/composite match or discrepancy keeps its deterministic status, with section facts attached only as advisory. A legacy no_comparison/not_comparable or absent regex plan does not suppress a complete supported section fact; identity, applicability and completeness blockers still affect both paths. Neither path can invent applicability or erase uncertainty of the other.

Frontend adds start/progress/error controls and displays the preliminary fact, question, missing context, boundaries and citations within the current verification workspace. The engine derives `start_page_number` and `end_page_number` for published section bounds from the actual endpoint blocks; these additive frozen fields are optional only for compatibility with older payloads. They are never accepted from the model or inferred from the first/last citation. Show source name and actual page range for each section; when an old snapshot lacks locations, state that rather than fabricating a range. Citation clicks reuse original PDF page/block navigation for both sides. Show coverage and failure honestly; raw provider/config details do not belong in the inspector flow. Reuse current decision actions. Confirm always means confirming a violation, not accepting the model's prose; label it accordingly. Add the explicit rejection reason `no_discrepancy` (Расхождение не подтверждено) to the shared decision contract, validation and UI so reviewing proposed agreement never forces an invented rejection reason. This additive reason records the inspector's decision; it does not add a finding status or a normative rule.

## Risks / Trade-offs

- Missing headings/notes or budget exhaustion → explicit partial coverage, bounded expansion, no automatic agreement.
- Existing dirty tree and concurrent work → scoped edits, baseline comparison, no reset/stash/commit or unrelated formatting.
- Legacy findings assume extraction IDs → additive discriminated section evidence plus compatible reader tests, no fake IDs.
- LLM latency exceeds current 120-second extraction lease → separate section task lease/heartbeat or bounded whole-task execution and fenced publication.
- Quoted text is true but inference is wrong → preliminary facts and inspector decision; real-document quality evaluation remains measurable and explicitly unverified until performed.

## Migration Plan

Use an additive migration on an isolated test database; never migrate production or replace existing rows. Generate Prisma client, verify new and old data, then run targeted tests/typechecks/builds. Deployment applies the migration, configures the compatible provider and explicitly enables section analysis. Rollback disables section analysis and retains immutable historical results; no destructive down migration is required.
