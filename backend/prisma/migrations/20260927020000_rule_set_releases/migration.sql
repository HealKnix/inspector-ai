CREATE TABLE rule_set_releases (
  id UUID PRIMARY KEY,
  manifest JSONB NOT NULL,
  manifest_hash CHAR(64) NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT release_manifest_shape CHECK (
    manifest->>'schema_version' = '1' AND
    manifest->>'mode' IN ('partial', 'full', 'legacy_capture') AND
    jsonb_typeof(manifest->'entries') = 'array'
  )
);
CREATE TRIGGER immutable_rule_set_release BEFORE UPDATE OR DELETE ON rule_set_releases
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TABLE rule_set_selection (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  release_id UUID REFERENCES rule_set_releases(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO rule_set_selection(id) VALUES(1);
ALTER TABLE runs ADD COLUMN rule_set_release_id UUID REFERENCES rule_set_releases(id) ON DELETE RESTRICT;
-- Historical Runs remain untouched: their exact approval state is unknown.
ALTER TABLE extractions ADD COLUMN numerical JSONB;
