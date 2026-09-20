-- CreateEnum
DO $$
BEGIN
    CREATE TYPE "FrameworkSetStatus" AS ENUM ('draft', 'approved', 'deprecated');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$
BEGIN
    CREATE TYPE "PackageStatus" AS ENUM ('proposed', 'confirmed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE "framework_sets" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "FrameworkSetStatus" NOT NULL DEFAULT 'draft',
    "note" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by" TEXT,
    "approved_at" TIMESTAMPTZ(3),

    CONSTRAINT "framework_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "framework_vocabularies" (
    "id" UUID NOT NULL,
    "set_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "norm_ref" TEXT,

    CONSTRAINT "framework_vocabularies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "framework_requirements" (
    "id" UUID NOT NULL,
    "set_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "kind_code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "norm_ref" TEXT,
    "applicability" JSONB,
    "quantity" JSONB NOT NULL,
    "alternatives" JSONB,

    CONSTRAINT "framework_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "framework_section_mappings" (
    "id" UUID NOT NULL,
    "set_id" UUID NOT NULL,
    "matrix_section" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "framework_section_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_versions" (
    "id" UUID NOT NULL,
    "object_id" UUID NOT NULL,
    "process_id" UUID,
    "version" INTEGER NOT NULL,
    "status" "PackageStatus" NOT NULL DEFAULT 'proposed',
    "framework_set_id" UUID NOT NULL,
    "attributes" JSONB NOT NULL,
    "basis" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_by" TEXT,
    "confirmed_at" TIMESTAMPTZ(3),

    CONSTRAINT "package_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_list_items" (
    "id" UUID NOT NULL,
    "package_version_id" UUID NOT NULL,
    "list_kind" TEXT NOT NULL,
    "item_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" JSONB,

    CONSTRAINT "package_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "package_requirements" (
    "id" UUID NOT NULL,
    "package_version_id" UUID NOT NULL,
    "framework_requirement_id" UUID,
    "list_item_id" UUID,
    "code" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "kind_code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scope" JSONB,
    "quantity" JSONB NOT NULL,
    "alternatives" JSONB,
    "origin" TEXT NOT NULL,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "exclusion_reason" TEXT,
    "source" JSONB,

    CONSTRAINT "package_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "completeness_results" (
    "id" UUID NOT NULL,
    "object_id" UUID NOT NULL,
    "process_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "package_version_id" UUID NOT NULL,
    "input_refs" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "completeness_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "framework_sets_version_key" ON "framework_sets"("version");

-- CreateIndex
CREATE UNIQUE INDEX "framework_vocabularies_set_id_kind_code_key" ON "framework_vocabularies"("set_id", "kind", "code");

-- CreateIndex
CREATE UNIQUE INDEX "framework_requirements_set_id_code_key" ON "framework_requirements"("set_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "framework_section_mappings_set_id_matrix_section_stage_code_key" ON "framework_section_mappings"("set_id", "matrix_section", "stage", "code");

-- CreateIndex
CREATE INDEX "package_versions_object_id_status_created_at_idx" ON "package_versions"("object_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "package_versions_object_id_version_key" ON "package_versions"("object_id", "version");

-- CreateIndex
CREATE INDEX "package_list_items_package_version_id_list_kind_idx" ON "package_list_items"("package_version_id", "list_kind");

-- CreateIndex
CREATE INDEX "package_requirements_package_version_id_idx" ON "package_requirements"("package_version_id");

-- CreateIndex
CREATE INDEX "completeness_results_object_id_process_id_created_at_idx" ON "completeness_results"("object_id", "process_id", "created_at");

-- AddForeignKey
ALTER TABLE "framework_vocabularies" ADD CONSTRAINT "framework_vocabularies_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "framework_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "framework_requirements" ADD CONSTRAINT "framework_requirements_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "framework_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "framework_section_mappings" ADD CONSTRAINT "framework_section_mappings_set_id_fkey" FOREIGN KEY ("set_id") REFERENCES "framework_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_versions" ADD CONSTRAINT "package_versions_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_versions" ADD CONSTRAINT "package_versions_framework_set_id_fkey" FOREIGN KEY ("framework_set_id") REFERENCES "framework_sets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_list_items" ADD CONSTRAINT "package_list_items_package_version_id_fkey" FOREIGN KEY ("package_version_id") REFERENCES "package_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_requirements" ADD CONSTRAINT "package_requirements_package_version_id_fkey" FOREIGN KEY ("package_version_id") REFERENCES "package_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_requirements" ADD CONSTRAINT "package_requirements_framework_requirement_id_fkey" FOREIGN KEY ("framework_requirement_id") REFERENCES "framework_requirements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "package_requirements" ADD CONSTRAINT "package_requirements_list_item_id_fkey" FOREIGN KEY ("list_item_id") REFERENCES "package_list_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "completeness_results" ADD CONSTRAINT "completeness_results_run_id_process_id_object_id_fkey" FOREIGN KEY ("run_id", "process_id", "object_id") REFERENCES "runs"("id", "process_id", "object_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "completeness_results" ADD CONSTRAINT "completeness_results_package_version_id_fkey" FOREIGN KEY ("package_version_id") REFERENCES "package_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
