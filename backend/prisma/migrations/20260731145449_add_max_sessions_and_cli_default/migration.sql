-- AlterTable
ALTER TABLE "cli_profiles" ADD COLUMN     "is_default" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "max_sessions" INTEGER NOT NULL DEFAULT 3;
