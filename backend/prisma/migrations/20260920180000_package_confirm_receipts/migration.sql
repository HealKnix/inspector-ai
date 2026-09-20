-- CreateTable
CREATE TABLE "package_confirm_receipts" (
    "user_id" TEXT NOT NULL,
    "object_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "package_version_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "package_confirm_receipts_pkey" PRIMARY KEY ("user_id", "object_id", "request_id")
);

-- AddForeignKey
ALTER TABLE "package_confirm_receipts" ADD CONSTRAINT "package_confirm_receipts_package_version_id_fkey" FOREIGN KEY ("package_version_id") REFERENCES "package_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
