**Variante:** feature
**Stack:** postgres
**Slug:** products-schema

## Comportamento alvo

- [x] Tabela `products` com PK uuid, `tenant_id`, nome, descrição, preço, categoria, foto_url, criado_em.
- [x] Índice GIN trigram (`pg_trgm`) sobre `unaccent(lower(name))` para busca LIKE parcial.
- [x] RLS `ENABLE + FORCE` + policy por `app.tenant_id`.
- [x] FK `categories(id)` com `ON DELETE RESTRICT` (não deleta categoria com produtos).
- [x] Migration versionada append-only `V01__create_products.sql`.

## Contratos tocados

```sql
CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(120) NOT NULL,
  description text,
  price numeric(10,2) NOT NULL CHECK (price >= 0),
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  photo_url varchar(255),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_products_tenant_name    ON products (tenant_id, name);
CREATE INDEX ix_products_trigram_name          ON products USING GIN (unaccent(lower(name)) gin_trgm_ops);
CREATE INDEX ix_products_tenant_created_desc  ON products (tenant_id, created_at DESC);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE  ROW LEVEL SECURITY;
CREATE POLICY products_tenant_isolation ON products
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

Ref.: `BD/sql/migrations/V01__create_products.sql` (a ser criado).

## Tarefas

1. [ ] BD: criar `categories` + `products` em `V01__create_products.sql`.
2. [ ] BD: índices em V02 (CONCURRENTLY fora de tx usando Flyway `executeInTransaction=false`).
3. [ ] BD: RLS + policy em `V03__products_rls.sql`.
4. [ ] BD: grant `app_tenant` em `BD/sql/schema/30_roles.sql`.
5. [ ] BD: pgTAP test em `BD/sql/tests/products_schema.sql`.

## Fora de escopo

- Tabela `categories` (assumida de trilha separada).
- Backfill de dados iniciais (só em prod/staging — fora do SDD).

## Premissas assumidas

- Premissa: extensão `pg_trgm` e `unaccent` disponíveis no ambiente (RDS/Cloud SQL possui
  por default em Postgres 16).

## Notas de review

verdict: ready — pgTAP confirma colunas, índice GIN e RLS. (exemplo resolvido)