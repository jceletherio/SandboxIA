-- pgTAP test para invariantes de schema
BEGIN;
-- CREATE EXTENSION IF NOT EXISTS pgtap;  -- habilitar no DB de teste

SELECT plan(3);

-- Tabela existe com colunas esperadas
SELECT has_table('orders');
SELECT has_column('orders', 'external_ref');
SELECT col_type_is('orders', 'external_ref', 'varchar(64)');

-- Constraint unique existe
SELECT has_index('orders', 'ix_orders_tenant_external');

-- RLS habilitada e FORCE
SELECT is(
  (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE relname = 'orders'),
  true,
  'orders deve ter RLS ENABLE + FORCE'
);

SELECT finish();
ROLLBACK;  -- nunca persiste estado