-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email" VARCHAR(320),
ADD COLUMN     "first_name" VARCHAR(100),
ADD COLUMN     "last_name" VARCHAR(100),
ADD COLUMN     "patronymic" VARCHAR(100),
ADD COLUMN     "phone" VARCHAR(32);
