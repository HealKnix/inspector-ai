-- Deprecated versions may retain their original approval timestamp. Existing
-- historical null timestamps remain valid and no working row is rewritten.
ALTER TABLE "rule_versions" DROP CONSTRAINT "rule_versions_approval_check";
ALTER TABLE "rule_versions" ADD CONSTRAINT "rule_versions_approval_check"
CHECK (status = 'deprecated' OR ((status = 'approved') = (approved_at IS NOT NULL)));

CREATE TABLE "rule_passports" (
  "id" UUID NOT NULL,
  "rule_version_id" UUID NOT NULL,
  "matrix_row_id" UUID NOT NULL,
  "revision" INTEGER NOT NULL CHECK ("revision" > 0),
  "content" JSONB NOT NULL,
  "content_hash" CHAR(64) NOT NULL,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rule_passports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rule_passports_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "rule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rule_passports_matrix_row_id_fkey" FOREIGN KEY ("matrix_row_id") REFERENCES "matrix_rows"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "rule_passports_rule_version_id_revision_key" ON "rule_passports"("rule_version_id", "revision");
CREATE UNIQUE INDEX "rule_passports_rule_version_id_content_hash_key" ON "rule_passports"("rule_version_id", "content_hash");

CREATE TABLE "rule_regression_reports" (
  "id" UUID NOT NULL,
  "rule_version_id" UUID NOT NULL,
  "passport_id" UUID NOT NULL,
  "rule_hash" CHAR(64) NOT NULL,
  "fixtures_hash" CHAR(64) NOT NULL,
  "engine_fingerprint" CHAR(64) NOT NULL,
  "report_hash" CHAR(64) NOT NULL,
  "report" JSONB NOT NULL,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rule_regression_reports_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rule_regression_reports_rule_version_id_fkey" FOREIGN KEY ("rule_version_id") REFERENCES "rule_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "rule_regression_reports_passport_id_fkey" FOREIGN KEY ("passport_id") REFERENCES "rule_passports"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "rule_regression_reports_rule_version_id_report_hash_key" ON "rule_regression_reports"("rule_version_id", "report_hash");
CREATE INDEX "rule_regression_reports_rule_version_id_created_at_idx" ON "rule_regression_reports"("rule_version_id", "created_at");

CREATE FUNCTION reject_matrix_review_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Matrix review records are immutable; append a new revision/report';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER immutable_rule_passports BEFORE UPDATE OR DELETE ON "rule_passports"
FOR EACH ROW EXECUTE FUNCTION reject_matrix_review_mutation();
CREATE TRIGGER immutable_rule_regression_reports BEFORE UPDATE OR DELETE ON "rule_regression_reports"
FOR EACH ROW EXECUTE FUNCTION reject_matrix_review_mutation();
