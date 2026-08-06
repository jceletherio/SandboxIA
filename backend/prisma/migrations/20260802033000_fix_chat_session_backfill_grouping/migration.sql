-- Corrige o backfill de 20260802032226_add_chat_message_session_and_thread.
--
-- Lá o chat_session_id vinha de `gen_random_uuid()` dentro de um subselect: o
-- planner inlinou a função volátil e a avaliou POR LINHA do join, então cada
-- mensagem legada virou uma "conversa" de 1 mensagem em vez de uma conversa por
-- projeto. Aqui o valor é DETERMINÍSTICO (md5 do project_id → uuid), o que
-- reagrupa tudo corretamente e é idempotente: rodar de novo dá o mesmo valor.
--
-- Roda imediatamente após a migration anterior, quando por definição toda linha
-- da tabela é pré-migração (legada) — por isso o UPDATE é incondicional.
-- Só escreve na coluna nova; nenhuma linha é apagada.
UPDATE "chat_messages"
SET "chat_session_id" =
  (md5('legacy-chat:' || coalesce("project_id", '__no_project__')))::uuid::text;
