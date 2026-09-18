CREATE TABLE "parsing_tasks" (
  "id" UUID NOT NULL PRIMARY KEY,
  "run_id" UUID NOT NULL,
  "file_id" UUID NOT NULL,
  "process_id" UUID NOT NULL,
  "object_id" UUID NOT NULL,
  "cycle" INTEGER NOT NULL DEFAULT 1 CHECK (cycle > 0),
  "state" TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','processing','succeeded','failed')),
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_until" TIMESTAMPTZ(3),
  "lease_token" UUID,
  "dispatched_at" TIMESTAMPTZ(3),
  "pipeline_fingerprint" CHAR(64),
  "pages_completed" INTEGER NOT NULL DEFAULT 0 CHECK (pages_completed >= 0),
  "pages_total" INTEGER CHECK (pages_total >= pages_completed),
  "error_code" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(3),
  CONSTRAINT "parsing_tasks_run_fkey" FOREIGN KEY (run_id, process_id, object_id) REFERENCES runs(id, process_id, object_id) ON DELETE RESTRICT,
  CONSTRAINT "parsing_tasks_file_fkey" FOREIGN KEY (file_id, process_id, object_id) REFERENCES files(id, process_id, object_id) ON DELETE RESTRICT,
  CONSTRAINT "parsing_tasks_input_fkey" FOREIGN KEY (run_id, file_id) REFERENCES run_inputs(run_id, file_id) ON DELETE RESTRICT,
  CONSTRAINT "parsing_tasks_lease_check" CHECK ((state = 'processing') = (lease_token IS NOT NULL AND lease_until IS NOT NULL))
);
CREATE UNIQUE INDEX "parsing_tasks_run_id_file_id_cycle_key" ON parsing_tasks(run_id, file_id, cycle);
CREATE INDEX "parsing_tasks_state_available_at_lease_until_idx" ON parsing_tasks(state, available_at, lease_until);
CREATE TABLE "parse_artifacts" (
  "id" UUID NOT NULL PRIMARY KEY,
  "task_id" UUID NOT NULL UNIQUE REFERENCES parsing_tasks(id) ON DELETE RESTRICT,
  "source_sha256" CHAR(64) NOT NULL,
  "pipeline_fingerprint" CHAR(64) NOT NULL,
  "storage_key" UUID NOT NULL,
  "artifact_sha256" CHAR(64) NOT NULL,
  "quality" TEXT NOT NULL CHECK (quality IN ('OK','LOW_QUALITY','ABSTAIN')),
  "reasons" TEXT[] NOT NULL,
  "pages_total" INTEGER NOT NULL CHECK (pages_total > 0),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "parse_artifacts_source_sha256_pipeline_fingerprint_idx" ON parse_artifacts(source_sha256, pipeline_fingerprint);
CREATE TABLE "parsing_retry_receipts" (
  "user_id" TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  "object_id" UUID NOT NULL REFERENCES objects(id) ON DELETE RESTRICT,
  "request_id" UUID NOT NULL,
  "task_id" UUID NOT NULL REFERENCES parsing_tasks(id) ON DELETE RESTRICT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, object_id, request_id)
);
