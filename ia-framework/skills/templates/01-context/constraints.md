---
title: Restrições
updated: 2026-08-05
kpis: { health: green }
---

# Restrições

Listadas para balizar decisões de arquitetura e segurança. Cada uma com **razão** — sem
razão, restrição vira dogma.

## Técnicas

- <restrição>: <razão / consequência se violada>.
  Ex.: "Postgres 16+ exigido — uso de `MERGE` e RLS multi-tenant sąo não negociáveis".

## Negócio

- <restrição de compliance, SLA, retenção, geografia etc.> — <razão>.

## Invioláveis (hardlines)

- **Segredos nunca em repo.** Variável de ambiente, KMS, Vault. Commit de `.env` = block.
- **Migrações DB são append-only.** Nunca edite migration já aplicada em ambiente — nova V.
- **Compatibilidade retroativa.** Campo novo nasce opcional; o que já está gravado continua
  carregando.
- **Sem `--no-verify`** nem bypass de hooks de CI sem aprovação explícita.