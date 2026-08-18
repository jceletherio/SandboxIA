# PostgreSQL 16+ — Padrões de Arquitetura

## Estrutura de diretórios (projeto monorepo)

```
src/BD/
  sql/
    schema/
      00_extensions.sql         CREATE EXTENSION IF NOT EXISTS ...
      10_types.sql               CREATE TYPE status ...
      20_enums_domains.sql
      30_roles.sql               roles + grants base
    tables/
      orders.sql                 CREATE TABLE orders ...
      order_items.sql
    indexes/
      orders_indexes.sql         CREATE INDEX CONCURRENTLY ...
    rls/
      tenant_rls.sql             ENABLE ROW LEVEL SECURITY por tabela
      tenant_policies.sql        CREATE POLICY ...
    views/
      orders_summary.sql         CREATE MATERIALIZED VIEW ... ou VIEW
    functions/
      recompute_summary.sql      CREATE FUNCTION ... TRIGGER
    migrations/                  gerado pela ferramenta (Flyway/migrate)
      V01__create_orders.sql
      V02__add_orders_external_ref.sql
    seeds/
      0100_seed_status.sql       dados de referência (só em dev/test); bloqueado em prod
  tests/
    rls_tests.sql                pgTAP para RLS: SET ROLE app_tenant; SELECT ... esperado erro
  Makefile
```

Ferramenta de migration lê `migrations/` em ordem. As pastas `schema/`, `tables/`,
`indexes/` etc. **não** são lidas pela ferramenta — é organização de manutenção humana.

## Migração — modelo Flyway versionado

```sql
-- V02__add_orders_external_ref.sql
BEGIN;

ALTER TABLE orders
  ADD COLUMN external_ref VARCHAR(64) NOT NULL DEFAULT '';

-- Backfill: para tabela grande, faça em chunks fora desta migration (job separado).
-- Aqui assume tabela pequena ou já em janela de manutenção.

CREATE UNIQUE INDEX CONCURRENTLY ix_orders_tenant_external
  ON orders (tenant_id, external_ref);
-- ↑ CONCURRENTLY NÃO pode rodar dentro de tx; Flyway por padrão envolve cada migration
-- em tx. Pra contornar: configure `executeInTransaction=false` na migration, ou use
-- CREATE INDEX (sem CONCURRENTLY) em janela de maintenance para tabelas pequenas.

COMMIT;
```

Regras:

- `V<NN>__<slug>.sql` snake_case no slug. Numeração sequencial sem saltos.
- Comment no topo: o que a migration faz e o porquê (decisão não óbvia).
- `BEGIN/COMMIT` explícito para múltiplos statements atômicos.
- `CONCURRENTLY` exige fora de tx (Flyway `executeInTransaction=false`) ou use técnica de
  migration separada só para o índice.
- **Nunca** editar migration já aplicada em qualquer ambiente compartilhado (staging/prod).

## Modelagem — tabelas principais

```sql
CREATE TABLE orders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  external_ref varchar(64) NOT NULL,
  status       order_status NOT NULL DEFAULT 'open',
  customer_id  uuid NOT NULL REFERENCES customers (id) ON DELETE RESTRICT,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE UNIQUE INDEX ix_orders_tenant_external
  ON orders (tenant_id, external_ref);

CREATE INDEX ix_orders_tenant_created_at
  ON orders (tenant_id, created_at DESC);

-- partition se volume: PARTITION BY RANGE (created_at)
```

- PK `uuid` preferido (sem contenção de sequence, distribui bem).
- `tenant_id` em toda tabela multi-tenant; FK quando há tabela de tenants.
- `created_at`/`updated_at` como `timestamptz`.
- `metadata jsonb` com `CHECK (jsonb_typeof(metadata) = 'object')` para evitar array/scalar.
- `CHECK` para invariantes de domínio.

## Enums vs FK

```sql
CREATE TYPE order_status AS ENUM ('open', 'paid', 'shipped', 'cancelled', 'returned');
```

Enum é bom para fixo e pequeno. Quando enums muda frequente (já precisa de insert em prod),
use tabela lookup + FK:

```sql
CREATE TABLE order_status_lk (code varchar(16) PRIMARY KEY, label varchar(64));
INSERT INTO order_status_lk VALUES ('open','Aberto'), ...;
ALTER TABLE orders ADD CONSTRAINT orders_status_fk FOREIGN KEY (status_code)
  REFERENCES order_status_lk (code);
```

Migrar enum→FK exige rewrite da coluna — qualquer um com `USING` cast.

## Índices — escolha do tipo

| Tipo | Quando |
| ---- | ----- |
| B-tree (default) | igualdade, range, `LIKE 'prefix%'`, `ORDER BY` |
| Hash (PG 10+) | só igualdade; útil p/ chaves curtas altamente repetidas (cuidado: não suporta range) |
| GIN `jsonb_path_ops` | `jsonb @>`, `?`, `?|`, `?&` |
| GIN `trigram` (`pg_trgm`) | `LIKE '%middle%'`, fuzzy text |
| GIST | range, geometria, full-text com `tsvector`, exclusão `EXCLUDE USING GIST` |
| BRIN | tabelas enormes com ordem natural correlacionada (logs, timeseries) |
| Partial `WHERE` | `WHERE active = true` — diminui tamanho e mantém hot path |
| Expression | `LOWER(email)`, computed columns |

## Índice — exemplos

```sql
-- equality + range
CREATE INDEX ix_orders_tenant_created ON orders (tenant_id, created_at DESC);

-- partial (ativos)
CREATE INDEX ix_orders_active ON orders (tenant_id, created_at DESC)
  WHERE status IN ('open', 'paid');

-- JSONB membership (gin)
CREATE INDEX ix_orders_metadata_gin ON orders USING GIN (metadata jsonb_path_ops);

-- trigram para busca parcial
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX ix_orders_external_trgm ON orders USING GIN (external_ref gin_trgm_ops);

-- expression
CREATE INDEX ix_customers_lower_email ON customers (LOWER(email));
```

**Sempre** rode `EXPLAIN (ANALYZE, BUFFERS)` antes/depois para confirmar uso.

## Full-text search

```sql
ALTER TABLE products ADD COLUMN search tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('portuguese', unaccent(coalesce(name,''))), 'A') ||
    setweight(to_tsvector('portuguese', unaccent(coalesce(description,''))), 'B')
  ) STORED;

CREATE INDEX ix_products_search ON products USING GIN (search);

SELECT id, name, ts_rank(search, phraseto_tsquery('portuguese', $1)) AS rank
FROM products
WHERE search @@ phraseto_tsquery('portuguese', $1)
ORDER BY rank DESC
LIMIT 20;
```

- `unaccent`(dict) exige extensão `unaccent`.
- `search` STORED — recomputa em INSERT/UPDATE automaticamente (coluna gerada).
- `phraseto_tsquery` em vez de `plainto_tsquery` quando ordem de palavras importa.

## Particionamento declarativo

```sql
CREATE TABLE orders (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  ...
  PRIMARY KEY (id, created_at)        -- PK deve incluir partition key
) PARTITION BY RANGE (created_at);

CREATE TABLE orders_2026_01 PARTITION OF orders
  FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE orders_2026_02 PARTITION OF orders
  FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
...
CREATE TABLE orders_default PARTITION OF orders DEFAULT;
```

- `pg_partman` para criar partições futuras: `SELECT partman.create_parent(...)`.
- PK/UNIQUE deve incluir partition key.
- Índices criados na tabela pai propagam para partições.

## RLS multi-tenant

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;  -- aplica até a owner

CREATE POLICY orders_tenant_isolation ON orders
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON orders TO app_role;
```

- App seta `SET app.tenant_id = '<uuid>'` no início da conexão.
- `FORCE` exige policy até para owner — para garantir mesmo em scripts admin.
- Para admin bypass em maintenance: `SET ROLE bypass_rls;` role com `BYPASSRLS`.

## Views e materialized views

```sql
CREATE VIEW orders_summary AS
SELECT tenant_id, status, count(*) AS cnt
FROM orders
GROUP BY tenant_id, status;

CREATE MATERIALIZED VIEW orders_summary_mv AS
SELECT tenant_id, status, count(*) AS cnt
FROM orders
GROUP BY tenant_id, status
WITH DATA;

CREATE UNIQUE INDEX ON orders_summary_mv (tenant_id, status);  -- p/ REFRESH CONCURRENTLY
```

- `REFRESH MATERIALIZED VIEW CONCURRENTLY orders_summary_mv` precisa de unique index.
- Use para agregados pesados TTL curto/longo conforme freshness.

## Functions e triggers

```sql
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER trg_orders_touch
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
```

Triggers são úteis para auditoria e campos maintenance. **Não** abuse para regras de
negócio exceed complexas — lógica fica no app.

## Parâmetros relevantes (tuning)

- `max_connections`, `shared_buffers` (25% RAM), `effective_cache_size` (50-75% RAM).
- `work_mem` (4-16MB), `maintenance_work_mem` (256MB+).
- `jit=off` para latência-<5ms alvo; on para query longa analítica.
- `synchronous_commit` = `off` só se容忍 data loss; default `on`.
- `statement_timeout` por sessão para migrações (`SET LOCAL statement_timeout = '5s';`).
- `lock_timeout` em migrations para evitar `ACCESS EXCLUSIVE` long.

## Backups / DR

- `pg_dump` base + WAL archive (`archive_mode = on`, `archive_command` para S3).
- PITR via `pg_rewind`/`recovery_target_time`.
- Replicação física streaming (sync ou async); lógica Debezium para CDC.
- Testar restore do backup periodicamente — backup sem test é fé.