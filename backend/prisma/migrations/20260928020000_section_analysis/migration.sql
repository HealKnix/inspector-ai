CREATE TABLE section_index_cache (
  fingerprint CHAR(64) PRIMARY KEY,
  boundaries JSONB NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE section_analysis_tasks (
  id UUID PRIMARY KEY,
  run_id UUID NOT NULL,
  process_id UUID NOT NULL,
  object_id UUID NOT NULL,
  cycle INTEGER NOT NULL DEFAULT 1 CHECK (cycle > 0),
  fingerprint CHAR(64) NOT NULL,
  resolved_input_hash CHAR(64) NOT NULL,
  source_fingerprint CHAR(64) NOT NULL,
  config_fingerprint CHAR(64) NOT NULL,
  matrix_import_id UUID NOT NULL REFERENCES matrix_imports(id) ON DELETE RESTRICT,
  matrix_rows JSONB NOT NULL,
  source_manifest JSONB NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','processing','succeeded','failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  available_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  dispatched_at TIMESTAMPTZ(3),
  lease_until TIMESTAMPTZ(3),
  lease_token UUID,
  error_code TEXT,
  result JSONB,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ(3),
  CONSTRAINT section_analysis_tasks_run_fk FOREIGN KEY (run_id, process_id, object_id)
    REFERENCES runs(id, process_id, object_id) ON DELETE RESTRICT,
  CONSTRAINT section_analysis_tasks_lease_check CHECK (
    (state = 'processing') = (lease_token IS NOT NULL AND lease_until IS NOT NULL)
  )
);
CREATE UNIQUE INDEX section_analysis_tasks_run_id_fingerprint_cycle_key
  ON section_analysis_tasks(run_id, fingerprint, cycle);
CREATE INDEX section_analysis_tasks_state_available_at_lease_until_idx
  ON section_analysis_tasks(state, available_at, lease_until);
CREATE INDEX section_analysis_tasks_process_id_created_at_idx
  ON section_analysis_tasks(process_id, created_at);

CREATE TABLE section_analysis_receipts (
  seq BIGSERIAL NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  object_id UUID NOT NULL REFERENCES objects(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL,
  run_id UUID NOT NULL,
  task_id UUID NOT NULL REFERENCES section_analysis_tasks(id) ON DELETE RESTRICT,
  fingerprint CHAR(64) NOT NULL,
  body_hash CHAR(64) NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT section_analysis_receipts_pkey
    PRIMARY KEY (user_id, object_id, request_id)
);
CREATE INDEX section_analysis_receipts_run_id_seq_idx
  ON section_analysis_receipts(run_id, seq);
