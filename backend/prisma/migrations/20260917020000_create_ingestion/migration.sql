-- CreateEnum
CREATE TYPE "ProcessStatus" AS ENUM ('PENDING', 'PARSING', 'READY', 'VERIFYING', 'COMPLETED', 'FINALIZED');

-- CreateTable
CREATE TABLE "processes" (
    "id" UUID NOT NULL,
    "object_id" UUID NOT NULL,
    "status" "ProcessStatus" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runs" (
    "id" UUID NOT NULL,
    "process_id" UUID NOT NULL,
    "object_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "input_manifest" JSONB NOT NULL,
    "input_manifest_hash" CHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "object_id" UUID NOT NULL,
    "process_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "original_name" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "storage_key" UUID NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "integrity_checked_at" TIMESTAMPTZ(3),
    "corrupted_at" TIMESTAMPTZ(3),

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_inputs" (
    "run_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "process_id" UUID NOT NULL,
    "object_id" UUID NOT NULL,

    CONSTRAINT "run_inputs_pkey" PRIMARY KEY ("run_id","file_id")
);

-- CreateTable
CREATE TABLE "upload_receipts" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "object_id" UUID NOT NULL,
    "client_upload_id" UUID NOT NULL,
    "fingerprint" CHAR(64) NOT NULL,
    "process_id" UUID,
    "run_id" UUID,
    "http_status" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upload_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "process_id" UUID NOT NULL,
    "object_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox" (
    "id" UUID NOT NULL,
    "job_id" UUID,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMPTZ(3),
    "lease_until" TIMESTAMPTZ(3),
    "lease_token" UUID,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "object_id" UUID,
    "action" TEXT NOT NULL,
    "request_id" UUID NOT NULL,
    "ip" TEXT,
    "details" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "processes_object_id_created_at_idx" ON "processes"("object_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "processes_id_object_id_key" ON "processes"("id", "object_id");

-- CreateIndex
CREATE UNIQUE INDEX "runs_id_process_id_object_id_key" ON "runs"("id", "process_id", "object_id");

-- CreateIndex
CREATE UNIQUE INDEX "runs_process_id_version_key" ON "runs"("process_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "files_storage_key_key" ON "files"("storage_key");

-- CreateIndex
CREATE INDEX "files_object_id_created_at_id_idx" ON "files"("object_id", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "files_id_process_id_object_id_key" ON "files"("id", "process_id", "object_id");

-- CreateIndex
CREATE INDEX "upload_receipts_object_id_user_id_created_at_idx" ON "upload_receipts"("object_id", "user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "upload_receipts_user_id_object_id_client_upload_id_key" ON "upload_receipts"("user_id", "object_id", "client_upload_id");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_run_id_kind_key" ON "jobs"("run_id", "kind");

-- CreateIndex
CREATE INDEX "outbox_delivered_at_available_at_idx" ON "outbox"("delivered_at", "available_at");

-- CreateIndex
CREATE INDEX "audit_events_object_id_created_at_idx" ON "audit_events"("object_id", "created_at");

-- AddForeignKey
ALTER TABLE "processes" ADD CONSTRAINT "processes_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "runs" ADD CONSTRAINT "runs_process_id_object_id_fkey" FOREIGN KEY ("process_id", "object_id") REFERENCES "processes"("id", "object_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_run_id_process_id_object_id_fkey" FOREIGN KEY ("run_id", "process_id", "object_id") REFERENCES "runs"("id", "process_id", "object_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_inputs" ADD CONSTRAINT "run_inputs_run_id_process_id_object_id_fkey" FOREIGN KEY ("run_id", "process_id", "object_id") REFERENCES "runs"("id", "process_id", "object_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_inputs" ADD CONSTRAINT "run_inputs_file_id_process_id_object_id_fkey" FOREIGN KEY ("file_id", "process_id", "object_id") REFERENCES "files"("id", "process_id", "object_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_receipts" ADD CONSTRAINT "upload_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_receipts" ADD CONSTRAINT "upload_receipts_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_receipts" ADD CONSTRAINT "upload_receipts_run_id_process_id_object_id_fkey" FOREIGN KEY ("run_id", "process_id", "object_id") REFERENCES "runs"("id", "process_id", "object_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_run_id_process_id_object_id_fkey" FOREIGN KEY ("run_id", "process_id", "object_id") REFERENCES "runs"("id", "process_id", "object_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
