-- DropIndex
DROP INDEX "evidence_groups_object_id_process_id_parameter_code_scope_k_key";

-- AlterTable
ALTER TABLE "extraction_tasks" ADD COLUMN     "resolved_input_hash" CHAR(64);

-- AlterTable
ALTER TABLE "evidence_groups" ADD COLUMN     "content_hash" CHAR(64),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "context_key" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "resolved_input_hash" CHAR(64),
ADD COLUMN     "run_id" UUID;

-- AlterTable
ALTER TABLE "protocols" ADD COLUMN     "resolved_input_hash" CHAR(64);

-- AlterTable
ALTER TABLE "findings" ADD COLUMN     "evidence_snapshot" JSONB;

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "object_id" UUID NOT NULL,
    "process_id" UUID NOT NULL,
    "identity_key" TEXT NOT NULL,
    "card_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_revisions" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "object_id" UUID NOT NULL,
    "process_id" UUID NOT NULL,
    "identity_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_document_parts" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "object_id" UUID NOT NULL,
    "process_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "artifact_id" UUID NOT NULL,
    "source_fingerprint" CHAR(64) NOT NULL,
    "first_page" INTEGER NOT NULL DEFAULT 1,
    "last_page" INTEGER NOT NULL,
    "machine" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_document_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_candidates" (
    "id" UUID NOT NULL,
    "part_id" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "raw" TEXT NOT NULL,
    "normalized" TEXT,
    "role" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "method" TEXT NOT NULL,
    "rules_version" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "field_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_clarifications" (
    "id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "revision_id" UUID NOT NULL,
    "object_id" UUID NOT NULL,
    "process_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "actor_id" TEXT NOT NULL,
    "request_id" UUID NOT NULL,
    "card_version" INTEGER NOT NULL,
    "basis" TEXT NOT NULL,
    "patch" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_clarifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resolved_input_snapshots" (
    "version" INTEGER NOT NULL DEFAULT 1,
    "id" UUID NOT NULL,
    "object_id" UUID NOT NULL,
    "process_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "input_manifest_hash" CHAR(64) NOT NULL,
    "resolved_input_hash" CHAR(64) NOT NULL,
    "source_fingerprint" CHAR(64) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resolved_input_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_resolution_receipts" (
    "user_id" TEXT NOT NULL,
    "process_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_resolution_receipts_pkey" PRIMARY KEY ("user_id","process_id","request_id")
);

-- CreateTable
CREATE TABLE "identification_tasks" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "process_id" UUID NOT NULL,
    "object_id" UUID NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lease_until" TIMESTAMPTZ(3),
    "lease_token" UUID,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMPTZ(3),
    "error_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "identification_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "documents_process_id_identity_key_key" ON "documents"("process_id", "identity_key");

-- CreateIndex
CREATE UNIQUE INDEX "documents_id_process_id_object_id_key" ON "documents"("id", "process_id", "object_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_revisions_document_id_identity_key_key" ON "document_revisions"("document_id", "identity_key");

-- CreateIndex
CREATE UNIQUE INDEX "document_revisions_id_document_id_process_id_object_id_key" ON "document_revisions"("id", "document_id", "process_id", "object_id");

-- CreateIndex
CREATE INDEX "file_document_parts_artifact_id_idx" ON "file_document_parts"("artifact_id");

-- CreateIndex
CREATE UNIQUE INDEX "file_document_parts_run_id_file_id_source_fingerprint_key" ON "file_document_parts"("run_id", "file_id", "source_fingerprint");

-- CreateIndex
CREATE INDEX "field_candidates_part_id_field_idx" ON "field_candidates"("part_id", "field");

-- CreateIndex
CREATE INDEX "document_clarifications_revision_id_card_version_idx" ON "document_clarifications"("revision_id", "card_version");

-- CreateIndex
CREATE INDEX "resolved_input_snapshots_process_id_created_at_idx" ON "resolved_input_snapshots"("process_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "resolved_input_snapshots_run_id_source_fingerprint_key" ON "resolved_input_snapshots"("run_id", "source_fingerprint");
CREATE UNIQUE INDEX "resolved_input_snapshots_run_id_version_key" ON "resolved_input_snapshots"("run_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "resolved_input_snapshots_run_id_resolved_input_hash_key" ON "resolved_input_snapshots"("run_id", "resolved_input_hash");

-- CreateIndex
CREATE INDEX "identification_tasks_state_available_at_lease_until_idx" ON "identification_tasks"("state", "available_at", "lease_until");

-- CreateIndex
CREATE UNIQUE INDEX "identification_tasks_run_id_fingerprint_key" ON "identification_tasks"("run_id", "fingerprint");

-- CreateIndex
CREATE INDEX "evidence_groups_object_id_process_id_run_id_idx" ON "evidence_groups"("object_id", "process_id", "run_id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_groups_snapshot_content_key" ON "evidence_groups"("run_id", "resolved_input_hash", "parameter_code", "context_key", "content_hash");
CREATE UNIQUE INDEX "evidence_groups_snapshot_version_key" ON "evidence_groups"("run_id", "resolved_input_hash", "parameter_code", "context_key", "version");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_process_id_object_id_fkey" FOREIGN KEY ("process_id", "object_id") REFERENCES "processes"("id", "object_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_revisions" ADD CONSTRAINT "document_revisions_document_id_process_id_object_id_fkey" FOREIGN KEY ("document_id", "process_id", "object_id") REFERENCES "documents"("id", "process_id", "object_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_document_parts" ADD CONSTRAINT "file_document_parts_revision_id_document_id_process_id_obj_fkey" FOREIGN KEY ("revision_id", "document_id", "process_id", "object_id") REFERENCES "document_revisions"("id", "document_id", "process_id", "object_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_document_parts" ADD CONSTRAINT "file_document_parts_file_id_process_id_object_id_fkey" FOREIGN KEY ("file_id", "process_id", "object_id") REFERENCES "files"("id", "process_id", "object_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_document_parts" ADD CONSTRAINT "file_document_parts_run_id_process_id_object_id_fkey" FOREIGN KEY ("run_id", "process_id", "object_id") REFERENCES "runs"("id", "process_id", "object_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_document_parts" ADD CONSTRAINT "file_document_parts_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "parse_artifacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_candidates" ADD CONSTRAINT "field_candidates_part_id_fkey" FOREIGN KEY ("part_id") REFERENCES "file_document_parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_clarifications" ADD CONSTRAINT "document_clarifications_revision_id_document_id_process_id_fkey" FOREIGN KEY ("revision_id", "document_id", "process_id", "object_id") REFERENCES "document_revisions"("id", "document_id", "process_id", "object_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resolved_input_snapshots" ADD CONSTRAINT "resolved_input_snapshots_run_id_process_id_object_id_fkey" FOREIGN KEY ("run_id", "process_id", "object_id") REFERENCES "runs"("id", "process_id", "object_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evidence_groups" ADD CONSTRAINT "evidence_groups_run_id_process_id_object_id_fkey" FOREIGN KEY ("run_id", "process_id", "object_id") REFERENCES "runs"("id", "process_id", "object_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "evidence_groups" ADD CONSTRAINT "evidence_groups_run_id_resolved_input_hash_fkey" FOREIGN KEY ("run_id", "resolved_input_hash") REFERENCES "resolved_input_snapshots"("run_id", "resolved_input_hash") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_run_id_resolved_input_hash_fkey" FOREIGN KEY ("run_id", "resolved_input_hash") REFERENCES "resolved_input_snapshots"("run_id", "resolved_input_hash") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Explicit scope and immutable provenance; no existing document is reinterpreted.
ALTER TABLE "document_clarifications" ADD CONSTRAINT "clarification_run_scope_fkey" FOREIGN KEY ("run_id", "process_id", "object_id") REFERENCES "runs"("id", "process_id", "object_id") ON DELETE RESTRICT;
ALTER TABLE "document_clarifications" ADD CONSTRAINT "clarification_actor_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "identification_tasks" ADD CONSTRAINT "identification_task_run_scope_fkey" FOREIGN KEY ("run_id", "process_id", "object_id") REFERENCES "runs"("id", "process_id", "object_id") ON DELETE RESTRICT;
ALTER TABLE "document_resolution_receipts" ADD CONSTRAINT "document_receipt_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT;
ALTER TABLE "document_resolution_receipts" ADD CONSTRAINT "document_receipt_process_fkey" FOREIGN KEY ("process_id") REFERENCES "processes"("id") ON DELETE RESTRICT;
ALTER TABLE "file_document_parts" ADD CONSTRAINT "whole_document_page_range" CHECK (first_page = 1 AND last_page >= first_page);
ALTER TABLE "documents" ADD CONSTRAINT "document_card_version_positive" CHECK (card_version >= 1);

CREATE FUNCTION identification_immutable_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'identification provenance is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER immutable_identification_part BEFORE UPDATE OR DELETE ON file_document_parts FOR EACH ROW EXECUTE FUNCTION identification_immutable_row();
CREATE TRIGGER immutable_identification_candidate BEFORE UPDATE OR DELETE ON field_candidates FOR EACH ROW EXECUTE FUNCTION identification_immutable_row();
CREATE TRIGGER immutable_identification_clarification BEFORE UPDATE OR DELETE ON document_clarifications FOR EACH ROW EXECUTE FUNCTION identification_immutable_row();
CREATE TRIGGER immutable_identification_snapshot BEFORE UPDATE OR DELETE ON resolved_input_snapshots FOR EACH ROW EXECUTE FUNCTION identification_immutable_row();
CREATE TRIGGER immutable_identification_receipt BEFORE UPDATE OR DELETE ON document_resolution_receipts FOR EACH ROW EXECUTE FUNCTION identification_immutable_row();

CREATE FUNCTION identification_part_source_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM parse_artifacts a JOIN parsing_tasks t ON t.id = a.task_id
    JOIN files f ON f.id = t.file_id WHERE a.id = NEW.artifact_id
    AND t.run_id = NEW.run_id AND t.file_id = NEW.file_id
    AND t.process_id = NEW.process_id AND t.object_id = NEW.object_id
    AND a.source_sha256 = f.sha256 AND t.state = 'succeeded') THEN
    RAISE EXCEPTION 'identification artifact scope mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER identification_part_source_scope BEFORE INSERT ON file_document_parts FOR EACH ROW EXECUTE FUNCTION identification_part_source_scope();

-- Legacy groups stay untouched. New snapshot-bound groups are append-only.
CREATE FUNCTION versioned_evidence_group_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.run_id IS NOT NULL THEN
    RAISE EXCEPTION 'snapshot evidence group is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER versioned_evidence_group_immutable BEFORE UPDATE OR DELETE ON evidence_groups FOR EACH ROW EXECUTE FUNCTION versioned_evidence_group_immutable();

CREATE FUNCTION finding_source_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.evidence_snapshot IS NOT NULL AND
    (NEW.evidence_snapshot IS DISTINCT FROM OLD.evidence_snapshot
     OR NEW.protocol_id IS DISTINCT FROM OLD.protocol_id
     OR NEW.object_id IS DISTINCT FROM OLD.object_id
     OR NEW.process_id IS DISTINCT FROM OLD.process_id
     OR NEW.parameter_code IS DISTINCT FROM OLD.parameter_code
     OR NEW.scope_key IS DISTINCT FROM OLD.scope_key
     OR NEW.evidence_group_id IS DISTINCT FROM OLD.evidence_group_id
     OR NEW.verdict IS DISTINCT FROM OLD.verdict
     OR NEW.gate_reasons IS DISTINCT FROM OLD.gate_reasons
     OR NEW.members_fingerprint IS DISTINCT FROM OLD.members_fingerprint) THEN
    RAISE EXCEPTION 'finding source snapshot is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER finding_source_snapshot_immutable BEFORE UPDATE ON findings FOR EACH ROW EXECUTE FUNCTION finding_source_snapshot_immutable();
