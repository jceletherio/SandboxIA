-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "chat_session_id" TEXT,
ADD COLUMN     "session_id" TEXT;

-- Backfill (P3.2 / CA3): toda mensagem pré-migração entra em UMA conversa
-- sintética por projeto ("Conversa inicial"), inclusive as sem project_id, que
-- viram um bucket próprio. Só escreve na coluna nova — nenhuma linha é apagada
-- e nenhum outro campo é tocado.
UPDATE "chat_messages" AS cm
SET "chat_session_id" = seed."chat_session_id"
FROM (
  SELECT p."project_id", gen_random_uuid()::text AS "chat_session_id"
  FROM (SELECT DISTINCT "project_id" FROM "chat_messages") AS p
) AS seed
WHERE cm."chat_session_id" IS NULL
  AND (cm."project_id" = seed."project_id"
       OR (cm."project_id" IS NULL AND seed."project_id" IS NULL));

-- CreateIndex
CREATE INDEX "chat_messages_session_id_idx" ON "chat_messages"("session_id");

-- CreateIndex
CREATE INDEX "chat_messages_chat_session_id_idx" ON "chat_messages"("chat_session_id");

-- CreateIndex
CREATE INDEX "chat_messages_project_id_chat_session_id_idx" ON "chat_messages"("project_id", "chat_session_id");
