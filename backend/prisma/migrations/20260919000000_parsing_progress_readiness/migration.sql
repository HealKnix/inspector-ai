-- Progress is informational and belongs to the fenced technical task. Existing
-- immutable artifacts and legacy progress stay intact; unknown metadata is NULL.
ALTER TABLE parsing_tasks
  ADD COLUMN phase TEXT,
  ADD COLUMN progress_updated_at TIMESTAMPTZ(3),
  ADD COLUMN waiting_reason TEXT,
  ADD COLUMN checkpoint_validated BOOLEAN,
  ADD COLUMN checkpoint_pages INTEGER CHECK (checkpoint_pages >= 0),
  ADD COLUMN current_page INTEGER CHECK (current_page > 0),
  ADD COLUMN previous_attempt_error TEXT,
  ADD COLUMN progress_reset_reason TEXT CHECK (progress_reset_reason IS NULL OR progress_reset_reason IN ('pipeline_version_changed', 'saved_pages_unavailable')),
  ADD COLUMN models_ready_deadline TIMESTAMPTZ(3),
  ADD CONSTRAINT parsing_tasks_checkpoint_count_check
    CHECK (checkpoint_pages IS NULL OR checkpoint_pages <= pages_completed),
  ADD CONSTRAINT parsing_tasks_current_page_total_check
    CHECK (current_page IS NULL OR pages_total IS NULL OR current_page <= pages_total),
  ADD CONSTRAINT parsing_tasks_phase_check CHECK (phase IS NULL OR phase IN (
    'checking_parser', 'waiting_models', 'waiting_capacity', 'starting',
    'checkpoint_verifying', 'resuming', 'rendering', 'layout', 'extracting',
    'ocr', 'publishing', 'retry_delay'
  )),
  ADD CONSTRAINT parsing_tasks_waiting_reason_check
    CHECK (waiting_reason IS NULL OR waiting_reason IN (
      'models_not_ready', 'parser_busy', 'retry_backoff'
    ));

CREATE INDEX parsing_tasks_state_models_ready_deadline_idx
  ON parsing_tasks(state, models_ready_deadline);
