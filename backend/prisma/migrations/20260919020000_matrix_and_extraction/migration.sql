CREATE TYPE "RuleStatus" AS ENUM ('draft', 'approved', 'rejected', 'deprecated');

CREATE TABLE matrix_imports (
  id UUID PRIMARY KEY,
  source_name TEXT NOT NULL,
  source_sha256 CHAR(64) NOT NULL,
  origin_sha256 CHAR(64) NOT NULL,
  row_count INTEGER NOT NULL CHECK (row_count > 0),
  imported_by TEXT,
  imported_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX matrix_imports_source_sha256_key ON matrix_imports(source_sha256);

CREATE TABLE matrix_rows (
  id UUID PRIMARY KEY,
  import_id UUID NOT NULL REFERENCES matrix_imports(id) ON DELETE RESTRICT,
  parameter_id INTEGER NOT NULL CHECK (parameter_id BETWEEN 1 AND 10000),
  parameter_code VARCHAR(32) NOT NULL,
  pd_section TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT,
  source_pd TEXT,
  source_rd TEXT,
  source_id TEXT,
  trigger_text TEXT NOT NULL,
  criticality TEXT,
  matrix_row INTEGER NOT NULL,
  raw JSONB NOT NULL
);
CREATE UNIQUE INDEX matrix_rows_import_id_parameter_id_key ON matrix_rows(import_id, parameter_id);
CREATE UNIQUE INDEX matrix_rows_import_id_parameter_code_key ON matrix_rows(import_id, parameter_code);
CREATE INDEX matrix_rows_parameter_code_idx ON matrix_rows(parameter_code);

CREATE TABLE rule_versions (
  id UUID PRIMARY KEY,
  parameter_code VARCHAR(32) NOT NULL,
  parameter_id INTEGER NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  status "RuleStatus" NOT NULL DEFAULT 'draft',
  plan JSONB NOT NULL,
  comparison JSONB,
  applicability JSONB,
  note TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_by TEXT,
  approved_at TIMESTAMPTZ(3),
  CONSTRAINT rule_versions_approval_check CHECK ((status = 'approved') = (approved_at IS NOT NULL))
);
CREATE UNIQUE INDEX rule_versions_parameter_code_version_key ON rule_versions(parameter_code, version);
CREATE INDEX rule_versions_status_parameter_code_idx ON rule_versions(status, parameter_code);

CREATE TABLE extraction_tasks (
  id UUID PRIMARY KEY,
  artifact_id UUID NOT NULL REFERENCES parse_artifacts(id) ON DELETE RESTRICT,
  cycle INTEGER NOT NULL DEFAULT 1 CHECK (cycle > 0),
  fingerprint CHAR(64) NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','processing','succeeded','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  available_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dispatched_at TIMESTAMPTZ(3),
  lease_until TIMESTAMPTZ(3),
  lease_token UUID,
  error_code TEXT,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ(3),
  CONSTRAINT extraction_tasks_lease_check CHECK ((state = 'processing') = (lease_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE UNIQUE INDEX extraction_tasks_artifact_id_cycle_key ON extraction_tasks(artifact_id, cycle);
CREATE INDEX extraction_tasks_state_available_at_lease_until_idx ON extraction_tasks(state, available_at, lease_until);

CREATE TABLE extractions (
  id UUID PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES extraction_tasks(id) ON DELETE RESTRICT,
  artifact_id UUID NOT NULL,
  file_id UUID NOT NULL,
  object_id UUID NOT NULL,
  process_id UUID NOT NULL,
  run_id UUID NOT NULL,
  parameter_code VARCHAR(32) NOT NULL,
  rule_version_id UUID NOT NULL REFERENCES rule_versions(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('extracted','ambiguous','no_evidence','unreadable','unsupported')),
  stage TEXT CHECK (stage IS NULL OR stage IN ('PD','RD','ID')),
  value_raw TEXT,
  value JSONB,
  unit TEXT,
  alternatives JSONB,
  reason TEXT,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT extractions_value_check CHECK ((status = 'extracted') = (value IS NOT NULL))
);
CREATE INDEX extractions_task_id_idx ON extractions(task_id);
CREATE INDEX extractions_object_id_parameter_code_idx ON extractions(object_id, parameter_code);

CREATE TABLE evidence_fragments (
  id UUID PRIMARY KEY,
  extraction_id UUID NOT NULL REFERENCES extractions(id) ON DELETE RESTRICT,
  file_id UUID NOT NULL,
  artifact_id UUID NOT NULL,
  page_number INTEGER NOT NULL CHECK (page_number > 0),
  sheet_label TEXT,
  block_id TEXT,
  table_id TEXT,
  table_row INTEGER,
  table_column INTEGER,
  quote TEXT NOT NULL,
  bbox JSONB,
  structural_path TEXT
);
CREATE INDEX evidence_fragments_extraction_id_idx ON evidence_fragments(extraction_id);

CREATE TABLE evidence_groups (
  id UUID PRIMARY KEY,
  object_id UUID NOT NULL,
  process_id UUID NOT NULL,
  parameter_code VARCHAR(32) NOT NULL,
  scope_key TEXT NOT NULL DEFAULT '',
  ruleset_hash CHAR(64) NOT NULL,
  members JSONB NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX evidence_groups_object_id_process_id_parameter_code_scope_key_key ON evidence_groups(object_id, process_id, parameter_code, scope_key);
