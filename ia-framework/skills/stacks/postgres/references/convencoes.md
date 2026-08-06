# PostgreSQL 16+ — Convenções

## Nomeação

- **Tabela**: plural, snake_case (`orders`, `order_items`, `audit_log`).
- **Coluna**: snake_case (`created_at`, `external_ref`, `tenant_id`).
- **PK**: singular `id` (uuid) ou `<table_singular>_id` em FK (`customer_id`).
- **FK**: `<entity_singular>_id` (`order_id`, `customer_id`).
- **Index**: `ix_<table>_<colunas>` (`ix_orders_tenant_created_at`).
- **Unique index**: `uq_<table>_<colunas>`.
- **Constraint**: `ck_<table>_<desc>` (check), `fk_<table>_<ref>`, `uk_<table>_<cols>`.
- **Type/Doman**: singular (`order_status`, `email`).
- **Enum value**: lowercase, sem underscore se possível (`open`, `paid`, `shipped`).
- **Function**: action verbo `recompute_summary`, `touch_updated_at`.
- **Trigger**: `trg_<table>_<action>` (`trg_orders_touch`).
- **Policy RLS**: `<table>_tenant_isolation`.

## Tipos de dados — escolha

| Uso | Tipo |
| --- | ---- |
| ID, UUID estruturado | `uuid` |
| ID, numérico alto volume | `bigint` (não `int`) |
| Incremento | `bigint GENERATED ALWAYS AS IDENTITY` (não `bigserial`) |
| Texto curto com limite | `varchar(N)` quando N é regra de dados, `text` quando é "ilimitado" |
| Texto livre | `text` |
| Data + hora | `timestamptz` (nunca `timestamp`) |
| Data | `date` |
| Boleano | `boolean` |
| Dinheiro | `numeric(p,s)` ou `bigint` cents |
| Float | `double precision` somente para científico, nunca dinheiro |
| JSON | `jsonb` (NUNCA `json`) |
| Binário | `bytea` |
| Enum fixo | `CREATE TYPE ... AS ENUM` |
| Range/duração | `tstzrange`, `int4range` |

## Constraints — sempre

- **PK**: toda tabela. Prefer `uuid`, ou `bigint GENERATED ALWAYS AS IDENTITY`.
- **FK**: explicitar `ON DELETE` e `ON UPDATE`:
  ```sql
  FOREIGN KEY (customer_id) REFERENCES customers (id) ON DELETE RESTRICT ON UPDATE CASCADE
  ```
- **UNIQUE**: para colunas/combinações com exclusividade (`tenant_id, external_ref`).
  Use `UNIQUE NULLS NOT DISTINCT` se NULL deve contar como "igual" (PG 15+).
- **CHECK**: invariantes de domínio (`CHECK (price >= 0)`, `CHECK (status IN (-1,0,1))`).
- **EXCLUDE**: ranges que não se sobrepõem:
  ```sql
  EXCLUDE USING gist (room_id WITH =, booking_range WITH &&)
  ```

## Migration — checklist

- `BEGIN;`/`COMMIT;` quando há múltiplos statements atômicos.
- Comentário no topo com **decisão** (não narrativa).
- `CONCURRENTLY` em índices novos sobre tabelas existentes com volume → tx separada
  (Flyway `executeInTransaction=false`).
- Backfill em chunks (10000 linhas por transaction) em job separado antes de `SET NOT NULL`.
- `lock_timeout` em migrations críticas:
  ```sql
  SET LOCAL lock_timeout = '2s';
  ```
- Para `ALTER TABLE` em volume, esquema `expand → migrate → contract`:
  1. Add column nullable/default (no lock).
  2. Backfill em chunks.
  3. `ALTER ... SET NOT NULL` (curto lock).
  4. Aplicar/revisar índices.
  5. Depois de janela, remover colunas antigas.

## Query — padrões

- Sem `SELECT *`. Colunas explícitas.
- `WHERE` com operators sargable (evita `LOWER(name) = 'x'` — use `LOWER(name) = $1` em
  coluna indexada via expression index, ou `name ILIKE 'X'`).
- `LIMIT` + `ORDER BY` com índice em `ORDER BY` para evitar sort.
- `JOIN` com tabela pequena OK. Em grandes, considere `EXISTS` em vez de `JOIN` para
  checagem.
- `LATERAL` quando subquery precisa de linha externa para índice selectivity.
- `CTE` é fence em PG ≤ 11; PG 12+ default inline. Use `MATERIALIZED` para fences
  explícitos (custo conhecido).

## Insert/update padrões

- Idempotência:
  ```sql
  INSERT INTO orders (id, external_ref, tenant_id, status)
  VALUES ($1, $2, $3, 'open')
  ON CONFLICT (tenant_id, external_ref) DO NOTHING
  RETURNING id;
  ```
  `DO NOTHING` para até-ocorreu; `DO UPDATE SET ...` para upsert idempotente.

- Bulk insert:
  ```sql
  INSERT INTO order_items (...)
  SELECT ... FROM unnest($1::order_item_input[])
  ```
  Para milhares de linhas em uma round-trip.

## Particionamento — quando adotar

- Volume > 10M registros por tabela **e** consulta comum filtra por partition key.
- BP: `PARTITION BY RANGE (created_at)`. Partição mensal/diário conforme volume.
- `pg_partman` (`CREATE EXTENSION pg_partman`) para criar partições futuras em job
  automático.
- Manter `orders_default` para evitar INSERT falhando — monitora 入 para alertar se
  cair na default.

## Backup / restore — scripts versionados

- `BD/ops/backup.sh` script para WAL archive target; em repo, só não-segredos.
- `BD/ops/restore-test.sh` script de restore PITR para 1h atrás — roda mensalmente em CI
  contra um container efêmero.

## Commit

`shared/git-conventions.md`. Scope: `schema`, `rls`, `index`, `partition`, `migration`.
Exemplo:

```
feat(orders): adiciona migration V02 com external_ref unique e índice partial p/ ativos
```

## Hardlines

- **Não** rode `migrate up`/`flyway migrate` contra DB de prod em trilha SDD — só
  `flyway info`/`migrate version`.
- **Não** `DROP` em trilha SDD sem transição (primeiro marcar deprecated, drop depois).
- **Não** dependa de ordem de migrations via nome arbitrário — use `V<NN>`.
- **Não** crie índice sem `CONCURRENTLY` em tabela grande sem pedir confirmação.
- **Não** commit `pg_dump` outputs; backup é operação fora de repo.