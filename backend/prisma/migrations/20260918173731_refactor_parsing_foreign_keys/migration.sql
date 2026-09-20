-- DropForeignKey
ALTER TABLE "parse_artifacts" DROP CONSTRAINT "parse_artifacts_task_id_fkey";

-- DropForeignKey
ALTER TABLE "parsing_retry_receipts" DROP CONSTRAINT "parsing_retry_receipts_object_id_fkey";

-- DropForeignKey
ALTER TABLE "parsing_retry_receipts" DROP CONSTRAINT "parsing_retry_receipts_task_id_fkey";

-- DropForeignKey
ALTER TABLE "parsing_retry_receipts" DROP CONSTRAINT "parsing_retry_receipts_user_id_fkey";

-- DropForeignKey
ALTER TABLE "parsing_tasks" DROP CONSTRAINT "parsing_tasks_file_fkey";

-- DropForeignKey
ALTER TABLE "parsing_tasks" DROP CONSTRAINT "parsing_tasks_input_fkey";

-- DropForeignKey
ALTER TABLE "parsing_tasks" DROP CONSTRAINT "parsing_tasks_run_fkey";

-- AddForeignKey
ALTER TABLE "parsing_tasks" ADD CONSTRAINT "parsing_tasks_run_id_process_id_object_id_fkey" FOREIGN KEY ("run_id", "process_id", "object_id") REFERENCES "runs"("id", "process_id", "object_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parsing_tasks" ADD CONSTRAINT "parsing_tasks_file_id_process_id_object_id_fkey" FOREIGN KEY ("file_id", "process_id", "object_id") REFERENCES "files"("id", "process_id", "object_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parse_artifacts" ADD CONSTRAINT "parse_artifacts_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "parsing_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parsing_retry_receipts" ADD CONSTRAINT "parsing_retry_receipts_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "parsing_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
