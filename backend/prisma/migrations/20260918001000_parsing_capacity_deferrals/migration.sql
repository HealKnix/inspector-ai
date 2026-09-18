-- A busy parser has not admitted this document. Keep capacity waiting separate
-- from the three document execution attempts, including across worker restarts.
ALTER TABLE parsing_tasks
  ADD COLUMN capacity_deferrals INTEGER NOT NULL DEFAULT 0 CHECK (capacity_deferrals >= 0);
