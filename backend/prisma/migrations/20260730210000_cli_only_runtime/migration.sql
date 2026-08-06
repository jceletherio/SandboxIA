-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('initializing', 'running', 'waiting', 'paused', 'completed', 'failed', 'timeout');

-- DropForeignKey
ALTER TABLE "log_entries" DROP CONSTRAINT "log_entries_session_id_fkey";

-- DropForeignKey
ALTER TABLE "questions" DROP CONSTRAINT "questions_session_id_fkey";

-- DropForeignKey
ALTER TABLE "sdd_artifacts" DROP CONSTRAINT "sdd_artifacts_session_id_fkey";

-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "cli_profile_id" TEXT;

-- AlterTable
ALTER TABLE "llm_models" DROP COLUMN "cost_per_token";

-- AlterTable
ALTER TABLE "phase_model_assignments" ADD COLUMN     "cli_profile_id" TEXT;

-- AlterTable
ALTER TABLE "questions" ALTER COLUMN "agent_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "exit_code" INTEGER,
ADD COLUMN     "mcp_token" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
ADD COLUMN     "pid" INTEGER,
ADD COLUMN     "tmux_session" TEXT,
DROP COLUMN "status",
ADD COLUMN     "status" "SessionStatus" NOT NULL DEFAULT 'initializing';

-- CreateTable
CREATE TABLE "cli_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "binary" TEXT NOT NULL,
    "interactive_args" JSONB NOT NULL,
    "one_shot_args" JSONB NOT NULL,
    "resume_args" JSONB,
    "mcp_config_file" TEXT NOT NULL,
    "mcp_config_template" JSONB NOT NULL,
    "env" JSONB,
    "one_shot_output" TEXT NOT NULL DEFAULT 'text',
    "one_shot_result_path" TEXT,
    "default_model" TEXT,
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cli_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cli_profiles_name_key" ON "cli_profiles"("name");

-- CreateIndex
CREATE INDEX "log_entries_session_id_created_at_idx" ON "log_entries"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "questions_session_id_status_idx" ON "questions"("session_id", "status");

-- CreateIndex
CREATE INDEX "questions_status_idx" ON "questions"("status");

-- CreateIndex
CREATE INDEX "scheduled_jobs_status_scheduled_at_idx" ON "scheduled_jobs"("status", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tmux_session_key" ON "sessions"("tmux_session");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_mcp_token_key" ON "sessions"("mcp_token");

-- CreateIndex
CREATE INDEX "sessions_status_idx" ON "sessions"("status");

-- CreateIndex
CREATE INDEX "sessions_macro_task_id_idx" ON "sessions"("macro_task_id");

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_cli_profile_id_fkey" FOREIGN KEY ("cli_profile_id") REFERENCES "cli_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sdd_artifacts" ADD CONSTRAINT "sdd_artifacts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_entries" ADD CONSTRAINT "log_entries_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phase_model_assignments" ADD CONSTRAINT "phase_model_assignments_cli_profile_id_fkey" FOREIGN KEY ("cli_profile_id") REFERENCES "cli_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sessions" ALTER COLUMN "mcp_token" DROP DEFAULT;
