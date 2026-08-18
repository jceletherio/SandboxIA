---
name: postgres
description: Conduz o fluxo SDD Enxuto para PostgreSQL 16+ — migrations versionadas (Flyway/golang-migrate/sqitch), normalização, índices B-tree/GIN/GIST/partial/expression, particionamento declarativo, RLS multi-tenant, JSONB+GIN, full-text search, EXPLAIN ANALYZE. Gatilhos: "migração SQL", "schema Postgres", "índice", "RLS", "query SQL", "partition", "/sdd postgres".
---

# PostgreSQL 16+ — fluxo SDD Enxuto

Spec antes do código. Fases gerais em `skills/shared/flow.md`; detalhes específicos em
`references/`.

| Fase | Produz | Fecha quando |
| ---- | ------ | ------------ |
| 1. Contexto | mapa de tabelas/índices/functions/RLS/migrations afetadas | escopo claro do schema tocado |
| 2. Spec + Tarefas | `02-specs/{NNN}-{slug}/spec.md` com DDL/DML contratada | tarefas executáveis sem adivinhar |
| 3. Implementação | migrations SQL + índices + RLS + views/functions | `migrate up` em Postgres de testcontainer roda |
| 4. Review + Testes | verdict sobre `EXPLAIN ANALYZE` + constraints + RLS | comportamento alvo bate |
| 5. Report | decisões de modelagem + armadilhas de migração | próxima sessão retoma |

## Princípios PostgreSQL

1. **Migrations versionadas append-only.** Flyway (`V<NN>__slug.sql`), Liquibase
   (`changeset id`), `golang-migrate` (`<NNNN>_name.up.sql`/`.down.sql`), `sqitch`. **Nunca**
   editar migration já aplicada em ambiente compartilhado — nova versão para corrigir.
2. **Normalização 3NF default.** Desnormalização é exceção justificada (hot path com
   leitura dominante), e fica como campo mantido por trigger ou projection via view
   materializada com refresh controlado.
3. **Índices com evidência.** Todo índice novo tem `EXPLAIN (ANALYZE, BUFFERS)` que
   justifica. Sem índice "por via das dúvidas" — índice custa INSERT/UPDATE.
4. **RLS para multi-tenant.** `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `CREATE POLICY
   tenant_isolation ON ... USING (tenant_id = current_setting('app.tenant_id')::uuid)`.
   `FORCE` quando há owner-bypass via role de serviço; role de app usa `SET app.tenant_id`.
5. **JSONB com índice GIN.** Sem `json` (não-binário). `jsonb` + `CHECK (jsonb_typeof(...) =
   'object')` + GIN `jsonb_path_ops`. Evitar chave-a-chave como coluna só se consulta é
   frequente para aquela chave (então vira coluna normal).
6. **Particionamento declarativo.** `PARTITION BY RANGE (created_at)`, subpartições por
   mês/dia conforme volume. `pg_partman` para criar partições futuras automaticamente.
7. **FKs com `ON DELETE` explícito.** `CASCADE` raro (só em composição), default
   `ON DELETE RESTRICT` ou `SET NULL`. Constraint `CHECK` para invariantes.
8. **`UNIQUE` cuidada.** `UNIQUE NULLS NOT DISTINCT` em PG 15+ se NULL deve contar. `EXCLUDE
   WITH` para ranges (ex.: intervalo não-sobreposto).
9. **Types com domínio.** Criar `DOMAIN email CHECK (value ~ '^[^@]+@[^@]+$')` para reutilizar
   constraints. `ENUM` para fixo lowercase (`CREATE TYPE order_status AS ENUM ('open',
   'paid', 'shipped')`).
10. **Tipos de dados certos.** `uuid` (PK preferido), `timestamptz` (nunca `timestamp`
    sem tz), `text` (não `varchar(N)` a não ser que N seja limite de dados, não " documentos"),
    `bigint`/`int` conforme range; `numeric(p,s)` para dinheiro (não `double`).
11. **Transações curvas.** Long-running locks mata concorrência. Set `statement_timeout`
    e `lock_timeout` por sessão para migrations; "done better than perfect".
12. **Pool e parametros.** `pgbouncer`/`pgcat` em modo transaction quando app stateless.
    Avaliar `jit` off em latência-alvo baixo.

## Setup (primeira vez)

1. `SDD_ROOT` (default `./project_sdd`). Árvore ausente →
   `pwsh skills/scaffold.ps1 init <SDD_ROOT>`.
2. `01-context/` vazio → rode `/sdd-context`.
3. Trilha: `pwsh skills/scaffold.ps1 new feature <slug>`.

## As 5 fases (específicas Postgres)

**1. Contexto.** Mapeie tabelas afetadas, índices existentes, FKs, RLS policies, migrations
aplicadas (ou ferramenta de migrate reading), views/materialized views, functions/triggers.
Consulte `\d+ <table>` ou `pg_indexes`. Ambiguidades: campo novo em tabela grande = backfill
online? Particionar? JSONB ou coluna normal? Index partial ou full?

**2. Spec + Tarefas.** Contrato = DDL que será criada (tabela, coluna, índice, policy) +
   DML esperada (`INSERT ... ON CONFLICT`, `SELECT ... WHERE ...`) + mudança de comportamento.
   Tarefas na ordem: 1) migration → 2) dados/backfill (se ALTER) → 3) índices → 4) RLS →
   5) functions/triggers → 6) verificação EXPLAIN.

**3. Implementação.** Padrões em `references/arquitetura.md`. SQL em
   `src/BD/sql/migrations/` ou ferramenta equivalente. Cada migration em arquivo próprio
   versionado. **Testar** com `testcontainers` se houver harness. Não rodar `migrate up`
   contra DB de prod em sessão SDD.

**4. Review + Testes.** Delegue ao `reviewer`. `EXPLAIN (ANALYZE, BUFFERS)` para hot path.
   Verifique: índice usado? Lock compatível com concorrência esperada? RLS cobre todos os
   access paths da tabela? FK com ON DELETE coerente com semântica? `statement_timeout`?
   Bug-fix: teste de regressão reproduz o bug (ex.: policy ausente deixou vazar registro).

**5. Report.** Decisões: índice partial vs full? partition por RANGE/LIST? JSONB vs coluna?
   FK RESTRICT vs CASCADE? Backfill online (chunked)? Lock `ACCESS EXCLUSIVE` evitado (use
   `CREATE INDEX CONCURRENTLY`, `ALTER ... SET NOT NULL` em dois passos)? Armadilhas:
   `VACUUM` por долгоrunning tx, autovacuum tuning, sequence esgotando, `bigserial` vs
   `int` para volume.

## Regras duras

- **Nunca** `DROP TABLE`/`DROP COLUMN` sem migration de transição (primeiro marcar
  deprecated → bloco window → drop depois que nada referencia).
- **Nunca** `ALTER COLUMN` tipo incompatível em um passo se tabela grande — strategy de
  tabela shadow ou `USING` cast explícito.
- **Nunca** `CREATE INDEX` sem `CONCURRENTLY` em tabela grande prod (lock `SHARE` que
  bloqueia writes).
- **Nunca** migration sem `BEGIN; ... COMMIT;` quando há múltiplos statements que devem ser
  atômicos (Flyway faz por arquivo; verifique se ferramenta usa tx).
- **Nunca** `SELECT *` em query de produção — explícito em colunas.
- **Nunca** consulta JSONB sem índice GIN em tabela grande — `jsonb @> ...` sem índice =
  seq scan.
- **Nunca** `COUNT(*)` em tabela grande sem necessidade — use estimativa `pg_class.reltuples`
  ou mantenha counter.
- **Sem** `id bigserial` se volume > 2 bilhões — `id bigidentity` ou `uuid`.
- **Sem** triggers mutantes na mesma tabela sem `BEFORE/AFTER` claro e ordem determinística.

## Limitação (declare no recibo)

Sem cluster Postgres vivo em sessão SDD. Review é estático (SQL, constraints, policies).
`EXPLAIN ANALYZE` só roda se requester prover via harness; normalmente estimamos baseado
em辑 statistics, índices e known anti-padrões.