# PostgreSQL — Testing

## Stack atual

- **PostgreSQL 16+**. Migrations via Flyway/golang-migrate/sqitch. RLS multi-tenant.
  pgcrypto para encrypt de PII (não hash de senha).

## Níveis × Frameworks

| Nível | Framework | Notas |
| ----- | --------- | ----- |
| Unitário (invariantes) | pgTAP | Valida schema, constraints, RLS habilitada com `FORCE`, tipos corretos. |
| Integração (apps) | Spring `@SpringBootTest`/Node `testcontainers`/Go `testcontainers-go` | Carga do schema via migrations; apps rodam contra container e validam tx. |
| Sistema | `pg_dump --schema-only` diff; assert role grants | Pré-release: confere se migrations aplicadas em ordem, schema migra OK entre releases. |
| Regressão | pgTAP ou SQL reprodução | Bug de migração que perdeu constraint → pgTAP asserting she existe. |

## Setup do projeto

`test-setup` adicionará:
- `BD/sql/tests/` directory
- `DB/sql/tests/pgtap.sql` scaffolding
- Se use `goose`/`golang-migrate`: `Makefile` target `test-db` que sobe container, aplica
  migrations, roda pgTAP, derruba container

## pgTAP — boilerplate

```sql
-- BD/sql/tests/orders_schema.sql
BEGIN;
-- CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(5);

-- Estrutura
SELECT has_table('orders');
SELECT has_column('orders', 'external_ref');
SELECT col_type_is('orders', 'external_ref', 'character varying(64)');

-- Constraint unique
SELECT has_index('orders', 'ix_orders_tenant_external');

-- RLS
SELECT is(
  (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE relname = 'orders'),
  true,
  'RLS ENABLE + FORCE em orders'
);

-- FK ON DELETE coerente
SELECT fk_ok('order_items', 'order_id', 'orders', 'id', 'cascade');

SELECT finish();
ROLLBACK;  -- nunca persiste
```

Run: `pg_prove -d test_db BD/sql/tests/orders_schema.sql`.

## RLS — test real com role

```sql
-- BD/sql/tests/orders_rls.sql
BEGIN;

-- como admin bypass, pode ver tudo
SET ROLE app_bypass;
SELECT lives_ok(
  $$ SELECT count(*) FROM orders; $$,
  'admin vê todas as orders'
);

-- como tenant_t1, só deve ver suas linhas
SET ROLE app_tenant;
SET LOCAL app.tenant_id = '11111111-1111-1111-1111-111111111111';

SELECT results_eq(
  $$ SELECT count(*) FROM orders; $$,
  ARRAY[0::bigint],
  'tenant_t1 não vê orders t2'
);

-- tentativa de setar tenant_id manualmente via INSERT deve respeitar WITH CHECK
SELECT throws_ok(
  $$ INSERT INTO orders (id, tenant_id, external_ref, status) VALUES (
     gen_random_uuid(),
     '22222222-2222-2222-2222-222222222222',
     'PO-X', 'open'
  ); $$,
  'new row violates row-level security policy',
  'INSERT com tenant_id alheio deve ser bloqueado'
);

SELECT finish();
ROLLBACK;
```

## Migration ordem e idempotência

Teste pré-release:

```sql
-- BD/sql/tests/migration_order.sql
BEGIN;
-- Aplica todas migrations V*.sql em ordem (flyway migrate --baselineOnMigrate=false)
-- Em seguida: schema está íntegro
SELECT has_table('orders');
SELECT has_table('order_items');
...
SELECT finish();
ROLLBACK;
```

Para garantir idempotência: rodar migrations de novo em container limpo deve ter sucesso;
testar com migration separada que dropa schema, reaplica, asserts.

## Bug-fix regressão — exemplo

Bug: migration `V15__add_orders_status_default.sql` foi aplicada mas esqueceu `DEFAULT
'open'`; inserts sem `status` falham no prod. Reprodução:

```sql
BEGIN;
-- re-aplica até V15
-- tentativa de INSERT sem status
SELECT throws_ok(
  $$ INSERT INTO orders (id, tenant_id, external_ref) VALUES (gen_random_uuid(), 't1', 'PO-X') $$,
  'null value in column "status" of relation "orders" violates not-null constraint'
);
SELECT finish();
ROLLBACK;
```

Após fix (migration `V16__set_status_default.sql`): mesmo INSERT deve passar. Teste de
regressão valida `V15 → V16` caminho.

## Testcontainers (aplicação↔BD)

Apps testam integração via Testcontainers (configuração descrita nos docs de cada stack em
`stacks/<stack>/references/testing.md`). Aqui, foco em testes de BD-isolado.

## Não faça

- Não crie `SELECT count(*) FROM orders WHERE tenant_id = '...'` em pgTAP e compare a
  zero — usa `results_eq` para que fail mostre diff.
- Não rode pgTAP contra BD de prod — sempre containerizado.
- Não commit resultados de testes (relatórios) — só os `.sql`.
- Não `DROP TABLE` em testes; use `ROLLBACK` para deixar o DB state limpo.