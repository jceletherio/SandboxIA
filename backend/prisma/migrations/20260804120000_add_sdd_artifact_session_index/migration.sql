-- Toda leitura de artefato filtra por sessão (`ArtifactsService.findAll`,
-- `findTaskReport` e o dedup do `backlog-ingest`) e ordena por `created_at desc`.
-- Até aqui era seq scan: `sdd_artifacts` só tinha a PK. A MT-7 tornou essa
-- leitura frequente — uma macro task de backlog por finding — então o custo
-- cresce junto com o backlog.
--
-- IF NOT EXISTS porque o banco é o do orquestrador rodando: se o índice já
-- tiver sido criado à mão, a migration não trava o deploy.
CREATE INDEX IF NOT EXISTS "sdd_artifacts_session_id_created_at_idx"
  ON "sdd_artifacts" ("session_id", "created_at");
