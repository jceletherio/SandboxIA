-- AlterTable
ALTER TABLE "scheduled_jobs" ADD COLUMN "project_id" TEXT;

-- Backfill: o escopo de projeto vivia SÓ dentro do payload Json. Sem isto, todo
-- job já agendado (inclusive os master_loop ativos e o qmd_embed pendente)
-- nasceria com project_id NULL e continuaria invisível para as consultas por
-- projeto — que é exatamente o bug que a coluna conserta.
UPDATE "scheduled_jobs"
SET "project_id" = "payload" ->> 'projectId'
WHERE jsonb_typeof("payload" -> 'projectId') = 'string';

-- CreateIndex
CREATE INDEX "scheduled_jobs_type_status_project_id_idx" ON "scheduled_jobs"("type", "status", "project_id");
