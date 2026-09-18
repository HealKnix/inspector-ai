BEGIN;
-- Block admission writes while backfilling canonical references and enabling enforcement.
LOCK TABLE files IN SHARE ROW EXCLUSIVE MODE;
CREATE UNIQUE INDEX files_id_object_id_sha256_key ON files(id, object_id, sha256);
CREATE TABLE object_file_contents (
  object_id uuid NOT NULL,
  sha256 char(64) NOT NULL,
  file_id uuid NOT NULL,
  CONSTRAINT object_file_contents_pkey PRIMARY KEY (object_id, sha256),
  CONSTRAINT object_file_contents_file_id_object_id_sha256_key UNIQUE (file_id, object_id, sha256),
  CONSTRAINT object_file_contents_file_id_object_id_sha256_fkey
    FOREIGN KEY (file_id, object_id, sha256) REFERENCES files(id, object_id, sha256)
    ON DELETE RESTRICT ON UPDATE RESTRICT
);
-- Keep every historical File/Run/receipt; use the earliest original for future duplicates.
INSERT INTO object_file_contents (object_id, sha256, file_id)
SELECT DISTINCT ON (object_id, sha256) object_id, sha256, id
FROM files ORDER BY object_id, sha256, created_at, id;

CREATE FUNCTION register_object_file_content() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO object_file_contents (object_id, sha256, file_id)
  VALUES (NEW.object_id, NEW.sha256, NEW.id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER register_file_content AFTER INSERT ON files
  FOR EACH ROW EXECUTE FUNCTION register_object_file_content();
CREATE TRIGGER immutable_file_content BEFORE UPDATE OR DELETE ON object_file_contents
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
COMMIT;
