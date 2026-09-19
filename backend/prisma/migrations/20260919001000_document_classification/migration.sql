CREATE TABLE classification_tasks (
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
  result JSONB,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMPTZ(3),
  CONSTRAINT classification_tasks_lease_check CHECK ((state = 'processing') = (lease_token IS NOT NULL AND lease_until IS NOT NULL)),
  CONSTRAINT classification_tasks_result_check CHECK ((state = 'succeeded') = (result IS NOT NULL))
);
CREATE UNIQUE INDEX classification_tasks_artifact_id_cycle_key ON classification_tasks(artifact_id, cycle);
CREATE INDEX classification_tasks_state_available_at_lease_until_idx ON classification_tasks(state, available_at, lease_until);
CREATE TABLE classification_retry_receipts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  object_id UUID NOT NULL REFERENCES objects(id) ON DELETE RESTRICT,
  request_id UUID NOT NULL,
  task_id UUID NOT NULL REFERENCES classification_tasks(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, object_id, request_id)
);
