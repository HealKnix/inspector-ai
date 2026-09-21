-- CreateEnum
CREATE TYPE "ProtocolStatus" AS ENUM ('active', 'superseded', 'finalized');

-- CreateEnum
CREATE TYPE "FindingStatus" AS ENUM ('CANDIDATE', 'CONFIRMED_VIOLATION', 'NEGATIVE_VERIFIED', 'CLARIFICATION_REQUIRED', 'MISSING_EVIDENCE', 'NOT_COMPARABLE', 'NOT_APPLICABLE');

-- CreateTable
CREATE TABLE "protocols" (
    "id" UUID NOT NULL,
    "object_id" UUID NOT NULL,
    "process_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ProtocolStatus" NOT NULL DEFAULT 'active',
    "scenario" TEXT NOT NULL,
    "ruleset_hash" CHAR(64),
    "input_manifest_hash" CHAR(64) NOT NULL,
    "findings_hash" CHAR(64) NOT NULL,
    "completeness_result_id" UUID,
    "content" JSONB NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalized_by" UUID,
    "finalized_at" TIMESTAMPTZ(3),

    CONSTRAINT "protocols_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "findings" (
    "id" UUID NOT NULL,
    "protocol_id" UUID NOT NULL,
    "object_id" UUID NOT NULL,
    "process_id" UUID NOT NULL,
    "parameter_code" VARCHAR(32) NOT NULL,
    "scope_key" TEXT NOT NULL DEFAULT '',
    "status" "FindingStatus" NOT NULL,
    "risk" TEXT,
    "evidence_group_id" UUID,
    "verdict" JSONB,
    "gate_reasons" JSONB,
    "members_fingerprint" CHAR(64) NOT NULL,
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "reason_code" TEXT,
    "comment" TEXT,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finding_decisions" (
    "id" UUID NOT NULL,
    "finding_id" UUID NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "from_status" "FindingStatus" NOT NULL,
    "to_status" "FindingStatus" NOT NULL,
    "reason_code" TEXT,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finding_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finding_decision_receipts" (
    "user_id" TEXT NOT NULL,
    "object_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "finding_id" UUID NOT NULL,
    "decision_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finding_decision_receipts_pkey" PRIMARY KEY ("user_id","object_id","request_id")
);

-- CreateIndex
CREATE INDEX "protocols_object_id_created_at_idx" ON "protocols"("object_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "protocols_process_id_version_key" ON "protocols"("process_id", "version");

-- CreateIndex
CREATE INDEX "findings_object_id_status_idx" ON "findings"("object_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "findings_protocol_id_parameter_code_scope_key_key" ON "findings"("protocol_id", "parameter_code", "scope_key");

-- CreateIndex
CREATE INDEX "finding_decisions_finding_id_created_at_idx" ON "finding_decisions"("finding_id", "created_at");

-- AddForeignKey
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_process_id_object_id_fkey" FOREIGN KEY ("process_id", "object_id") REFERENCES "processes"("id", "object_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "protocols" ADD CONSTRAINT "protocols_run_id_process_id_object_id_fkey" FOREIGN KEY ("run_id", "process_id", "object_id") REFERENCES "runs"("id", "process_id", "object_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "findings" ADD CONSTRAINT "findings_protocol_id_fkey" FOREIGN KEY ("protocol_id") REFERENCES "protocols"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_decisions" ADD CONSTRAINT "finding_decisions_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_decisions" ADD CONSTRAINT "finding_decisions_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_decision_receipts" ADD CONSTRAINT "finding_decision_receipts_finding_id_fkey" FOREIGN KEY ("finding_id") REFERENCES "findings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finding_decision_receipts" ADD CONSTRAINT "finding_decision_receipts_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "finding_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
