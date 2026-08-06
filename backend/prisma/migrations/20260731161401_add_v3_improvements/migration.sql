-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "settings" JSONB;

-- AlterTable
ALTER TABLE "scheduled_jobs" ADD COLUMN     "notes" TEXT;

-- CreateTable
CREATE TABLE "project_skills" (
    "projectId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_skills_pkey" PRIMARY KEY ("projectId","skillId")
);

-- CreateTable
CREATE TABLE "project_mcps" (
    "projectId" TEXT NOT NULL,
    "mcpId" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_mcps_pkey" PRIMARY KEY ("projectId","mcpId")
);

-- CreateTable
CREATE TABLE "session_history" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "macro_task_id" TEXT,
    "project_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "branch" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "artifacts_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "session_history_session_id_key" ON "session_history"("session_id");

-- CreateIndex
CREATE INDEX "session_history_project_id_idx" ON "session_history"("project_id");

-- CreateIndex
CREATE INDEX "session_history_macro_task_id_idx" ON "session_history"("macro_task_id");

-- CreateIndex
CREATE INDEX "log_entries_project_id_idx" ON "log_entries"("project_id");

-- CreateIndex
CREATE INDEX "macro_tasks_project_id_idx" ON "macro_tasks"("project_id");

-- CreateIndex
CREATE INDEX "macro_tasks_status_idx" ON "macro_tasks"("status");

-- CreateIndex
CREATE INDEX "sessions_started_at_idx" ON "sessions"("started_at");

-- AddForeignKey
ALTER TABLE "project_skills" ADD CONSTRAINT "project_skills_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_skills" ADD CONSTRAINT "project_skills_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_mcps" ADD CONSTRAINT "project_mcps_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_mcps" ADD CONSTRAINT "project_mcps_mcpId_fkey" FOREIGN KEY ("mcpId") REFERENCES "mcps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
