/*
  Warnings:

  - Made the column `first_name` on table `users` required. This step will fail if there are existing NULL values in that column.
  - Made the column `last_name` on table `users` required. This step will fail if there are existing NULL values in that column.

*/
-- Backfill required names for pre-existing users with their login
UPDATE "users"
SET "last_name" = COALESCE("last_name", "login"),
    "first_name" = COALESCE("first_name", "login");

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "first_name" SET NOT NULL,
ALTER COLUMN "last_name" SET NOT NULL;
