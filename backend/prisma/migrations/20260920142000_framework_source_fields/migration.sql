-- AlterTable
ALTER TABLE "framework_sets" ADD COLUMN "source_name" TEXT;
ALTER TABLE "framework_sets" ADD COLUMN "source_sha256" CHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX "framework_sets_source_sha256_key" ON "framework_sets"("source_sha256");

-- DropIndex
DROP INDEX "framework_section_mappings_set_id_matrix_section_stage_code_key";

-- AlterTable
ALTER TABLE "framework_section_mappings" ALTER COLUMN "code" DROP NOT NULL;
ALTER TABLE "framework_section_mappings" ADD COLUMN "source_text" TEXT;
