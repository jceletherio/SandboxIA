-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN     "project_id" TEXT;

-- CreateIndex
CREATE INDEX "chat_messages_project_id_idx" ON "chat_messages"("project_id");
