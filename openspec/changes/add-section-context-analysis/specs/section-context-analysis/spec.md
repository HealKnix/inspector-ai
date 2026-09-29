## Purpose

Позволяет инспектору получать проверяемые предварительные факты по нескольким пунктам Матрицы из сопоставленных разделов строительных документов с сохранением границ, цитат и актуальности источников.

## ADDED Requirements

### Requirement: Compact discovery on authorized selected sources

The system SHALL identify section boundaries from bounded structural candidates and SHALL use only currently selected document revisions and sheets in a resolved comparison context.

#### Scenario: Excluded sheet contains a tempting heading

- **WHEN** an excluded or superseded sheet contains a relevant heading
- **THEN** neither discovery nor analysis sends that sheet to the model or cites it.

#### Scenario: Boundary needs clarification

- **WHEN** compact candidates do not establish a valid section boundary
- **THEN** a bounded expansion is attempted or the ambiguity is returned explicitly without sending the whole document as fallback.

### Requirement: Reusable complete section context

The system SHALL reuse validated section indexes and SHALL preserve all eligible section blocks, table structure and source locators while tracking context coverage.

#### Scenario: Multiple parameters use the same section

- **WHEN** several matrix rows reference the same selected section
- **THEN** section discovery is reused and the rows can be analyzed together.

#### Scenario: Section exceeds one request

- **WHEN** a section cannot fit within one bounded request
- **THEN** all required parts are processed with explicit coverage or the affected result states the missing context; a truncated prefix is never reported as complete.

#### Scenario: Unreadable table beside readable text

- **WHEN** a selected section touches a page with readable text and an unresolved table or unknown region
- **THEN** the affected parameter has incomplete coverage even when the unresolved region produced no text blocks.

#### Scenario: One matrix row lacks a section

- **WHEN** one requested row has complete grounded sources and another row has no relevant section
- **THEN** the supported row retains its preliminary fact and quotes, the unsupported row remains incomplete, and aggregate coverage reports the gap without erasing unrelated facts.

### Requirement: Validated matrix facts and citations

The system SHALL return a schema-validated result for every requested real matrix row with fact, assessment, evidence, missing context and inspector question. It SHALL validate each quote against the exact submitted source block and derive locators server-side.

#### Scenario: Invalid model response

- **WHEN** a response invents a quote, references a foreign block, omits a parameter or duplicates a parameter
- **THEN** the response is rejected and cannot create a verified fact.

#### Scenario: No regex extraction plan exists

- **WHEN** a real matrix row is selected for section analysis without an approved regex plan
- **THEN** the section analyzer can produce a separately identified preliminary fact without fabricating or approving a regex rule.

### Requirement: Explicit bounded provider use

The system SHALL require explicit section-analysis enablement, bounded requests and strict structured output validation. Document instructions SHALL NOT execute tools or alter source selection.

#### Scenario: Section analysis disabled

- **WHEN** classification is enabled but section analysis is disabled
- **THEN** no section text is sent to the provider.

#### Scenario: Provider returns refusal or incomplete output

- **WHEN** a provider refuses, truncates or fails a request
- **THEN** the system preserves a visible technical failure or missing-context result rather than successful analysis.

#### Scenario: Serialized provider request approaches the byte limit

- **WHEN** section parts or reconciliation observations are packed into a request
- **THEN** the byte calculation includes the provider envelope, system instructions, schema and JSON escaping, and every emitted request respects the configured bound.

### Requirement: Durable current-result publication

The system SHALL execute section analysis asynchronously and idempotently, pin matrix and source versions, bound retries, and fence late or stale results.

#### Scenario: Sources change while provider works

- **WHEN** a new run, sheet selection, parsing result, matrix/configuration version or finalization supersedes the admitted task
- **THEN** the old result cannot replace current facts or modify the finalized protocol.

#### Scenario: Duplicate delivery and worker restart

- **WHEN** a message repeats or a worker restarts after claiming a task
- **THEN** recovery is bounded and does not create duplicate fact sets.

### Requirement: Inspector review and historical compatibility

The system SHALL show preliminary facts, questions, missing context and navigable source evidence in the current verification workspace and SHALL retain existing human decision permissions, deterministic checks and history.

#### Scenario: Grounded preliminary fact

- **WHEN** a complete grounded fact is published
- **THEN** an authorized inspector can inspect its exact pages and apply the existing review actions; no violation or negative verification is confirmed by the LLM.

#### Scenario: Meaning changes between protocol versions

- **WHEN** a fact, question, missing context, source selection or analysis basis changes
- **THEN** the previous human decision is not silently carried to the changed evidence.

#### Scenario: Unfinished task or legacy finding

- **WHEN** protocol generation meets an unfinished requested section task or reads a historical finding without section data
- **THEN** generation waits or rejects unfinished work while the historical finding stays readable without invented evidence.
