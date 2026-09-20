ALTER TABLE files ADD CONSTRAINT files_format_check CHECK (format IN ('PDF', 'DOCX', 'XML'));
ALTER TABLE files ADD CONSTRAINT files_size_check CHECK (size BETWEEN 0 AND 50000000);
ALTER TABLE files ADD CONSTRAINT files_sha256_check CHECK (sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE upload_receipts ADD CONSTRAINT receipt_run_pair CHECK (
  (http_status = 202 AND process_id IS NOT NULL AND run_id IS NOT NULL) OR
  (http_status = 422 AND process_id IS NULL AND run_id IS NULL)
);
CREATE FUNCTION reject_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable ingestion record'; END;
$$;
CREATE TRIGGER immutable_run BEFORE UPDATE OR DELETE ON runs FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_receipt BEFORE UPDATE OR DELETE ON upload_receipts FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_input BEFORE UPDATE OR DELETE ON run_inputs FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE FUNCTION protect_original() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Original cannot be deleted'; END IF;
  IF (to_jsonb(NEW) - 'integrity_checked_at' - 'corrupted_at') IS DISTINCT FROM
     (to_jsonb(OLD) - 'integrity_checked_at' - 'corrupted_at') THEN
    RAISE EXCEPTION 'Original metadata is immutable';
  END IF;
  IF OLD.corrupted_at IS NOT NULL AND NEW.corrupted_at IS DISTINCT FROM OLD.corrupted_at THEN
    RAISE EXCEPTION 'Integrity incident cannot be erased';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER immutable_original BEFORE UPDATE OR DELETE ON files FOR EACH ROW EXECUTE FUNCTION protect_original();
