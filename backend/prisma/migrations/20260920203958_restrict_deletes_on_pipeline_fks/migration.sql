-- DropForeignKey
ALTER TABLE "classification_retry_receipts" DROP CONSTRAINT "classification_retry_receipts_object_id_fkey";

-- DropForeignKey
ALTER TABLE "classification_retry_receipts" DROP CONSTRAINT "classification_retry_receipts_task_id_fkey";

-- DropForeignKey
ALTER TABLE "classification_retry_receipts" DROP CONSTRAINT "classification_retry_receipts_user_id_fkey";

-- DropForeignKey
ALTER TABLE "classification_tasks" DROP CONSTRAINT "classification_tasks_artifact_id_fkey";

-- DropForeignKey
ALTER TABLE "evidence_fragments" DROP CONSTRAINT "evidence_fragments_extraction_id_fkey";

-- DropForeignKey
ALTER TABLE "extraction_tasks" DROP CONSTRAINT "extraction_tasks_artifact_id_fkey";

-- DropForeignKey
ALTER TABLE "extractions" DROP CONSTRAINT "extractions_rule_version_id_fkey";

-- DropForeignKey
ALTER TABLE "extractions" DROP CONSTRAINT "extractions_task_id_fkey";

-- DropForeignKey
ALTER TABLE "matrix_rows" DROP CONSTRAINT "matrix_rows_import_id_fkey";

-- AlterTable
ALTER TABLE "evidence_groups" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "classification_tasks" ADD CONSTRAINT "classification_tasks_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "parse_artifacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classification_retry_receipts" ADD CONSTRAINT "classification_retry_receipts_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "classification_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matrix_rows" ADD CONSTRAINT "matrix_rows_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "matrix_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extraction_tasks" ADD CONSTRAINT "extraction_tasks_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "parse_artifacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "extractions" ADD CONSTRAINT "extractions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "extraction_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence_fragments" ADD CONSTRAINT "evidence_fragments_extraction_id_fkey" FOREIGN KEY ("extraction_id") REFERENCES "extractions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "evidence_groups_object_id_process_id_parameter_code_scope_key_k" RENAME TO "evidence_groups_object_id_process_id_parameter_code_scope_k_key";
