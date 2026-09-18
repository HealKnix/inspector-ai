CREATE TABLE "objects" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "objects_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "objects_name_not_blank" CHECK (length(btrim("name")) > 0),
    CONSTRAINT "objects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "objects_created_at_id_idx" ON "objects"("created_at", "id");

CREATE TABLE "object_access" (
    "object_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "granted_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "object_access_pkey" PRIMARY KEY ("object_id", "user_id"),
    CONSTRAINT "object_access_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "object_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "object_access_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "object_access_user_id_object_id_idx" ON "object_access"("user_id", "object_id");
