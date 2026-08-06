# PostgreSQL 16+ — Segurança

## OWASP Top 10 por item (camada DB)

| Código | Item | Em Postgres |
| ------ | ---- | ----------- |
| A01 | Broken Access | Roles least-privilege; RLS multi-tenant; grants explícitos por tabela; não `GRANT ALL`. |
| A02 | Crypto Fail | `pgcrypto` para hash/encrypt; `gen_random_uuid()`; TLS no client (`sslmode=verify-full`). **Nunca** MD5 de senha — argon2 na app. |
| A03 | Injection (SQL) | Queries parameterized; funções `format()` só para identifiers (com `%I`), não valores. Sem concatenação. |
| A04 | Insecure Design | Threat modeling na spec fase 2: quem vê o quê, cruzando RLS. |
| A05 | Security Misconfig | `pg_hba.conf` restrito a IPs da app; `listen_addresses` não `*`; `password_encryption = scram-sha-256`; SSL on; `log_connections` em ambientes monitorados. |
| A06 | Vuln Deps | `pg` extensões de fonte conhecida; `postgresql.conf` parameter review por release; CVE monitorado. |
| A07 | Auth Fail | Role de app sem password hardcoded — secret manager; conexão com `sslmode=verify-full`; cert mutuo quando sensível. |
| A08 | Integrity Fail | FKs + `CHECK` + `UNIQUE` + `EXCLUDE`; triggers de auditoria imutáveis. |
| A09 | Logging | `log_statement = 'ddl'` (não `all` — PII); `log_line_prefix` com IP/app; auditoria dedicada via triggers em `audit_log`. |
| A10 | SSRF (indireto) | `dblink`/`postgres_fdw` — restriction de hosts; `file_fdw` com allowlist. |

## Roles e grants — least privilege

```sql
-- Roles base
CREATE ROLE app_tenant;
CREATE ROLE app_bypass BYPASSRLS;     -- maintenance, scripts admin

-- Esquema
GRANT USAGE ON SCHEMA public TO app_tenant;

-- Tabelas: granular, jamais GRANT ALL
GRANT SELECT, INSERT, UPDATE, DELETE ON orders TO app_tenant;
GRANT SELECT, INSERT, UPDATE, DELETE ON order_items TO app_tenant;
GRANT USAGE, SELECT ON SEQUENCE orders_id_seq TO app_tenant;   -- se bigserial/serial

-- Sequences (uuid gen_random_uuid() não precisa); on bigserial, sempre
GRANT USAGE ON SEQUENCE orders_id_seq TO app_tenant;
```

- App conecta com `app_tenant`, nunca `postgres`/superuser.
- `app_bypass` só para manutenção fora de request.
- Default privileges em schema:

```sql
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_tenant;
```

## pg_hba.conf

```
# TYPE  DATABASE    USER          ADDRESS          METHOD
hostssl  app_db      app_tenant    10.0.0.0/24    scram-sha-256
hostssl  app_db      app_bypass    10.0.0.5/32    scram-sha-256 clientcert=1
local    all         all                           peer
```

- `trust` **proibido** salvo `local` para admin best prática.
- `scram-sha-256` desde PG 14 (default em 14+).
- `clientcert=1` quando possível para bypass role.
- `listen_addresses = '127.0.0.1,<db_internal_ip>'`, não `*`.

## RLS — modelo multi-tenant robusto

```sql
-- 0) Extensions (se usar unaccent não aqui)
-- 1) Role padrão da app
SET ROLE app_tenant;  -- na conexão (ou por pool pgbouncer)

-- 2) Tabelas com tenant_id e RLS
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE  ROW LEVEL SECURITY;   -- aplica até a owner

CREATE POLICY orders_tenant_isolation ON orders
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- 3) App seta tenant a cada request (no início da tx)
SET LOCAL app.tenant_id = '<uuid>';  -- LOCAL: desabilita em COMMIT; tx-bound
```

- `SET LOCAL` (não `SET`) garante isolamento por transação.
- Pool pgbouncer em modo transaction `SET LOCAL` funciona; em modo session, use reset.
- Verificar: `SELECT current_setting('app.tenant_id');` no início do request.

### RLS em FK e joins

RLS aplica ao ler/escrever a tabela, **não** ao FK constraint (FK é validado antes da RLS).
Cuidado com `JOIN` em tabela externas — RLS aplica a cada tabela独立. Confirme policies
em todas as tabelas relacionadas.

## SQL injection — funções seguras

```sql
-- errado
EXECUTE 'SELECT ... WHERE name = ''' || v_name || '''';    -- NUNCA

-- certo
EXECUTE format('SELECT ... WHERE name = %L', v_name);      -- %L para literal
EXECUTE format('SELECT ... ORDER BY %I', sort_col);        -- %I para identifier (quote)
```

`format`— para valores, use `%L` que produz literal quoted; para identifiers, `%I` que
produz ident quoted. **Ainda assim** prefira queries estáticas com parâmetros bind da
driver (`$1`).

## pgcrypto

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- hash de senha NÃO no DB — bcrypt/argon2 são CPU-bound e travão pool; faça na app.
-- Mas encrypt de campos sensíveis PII/token stateless com chave em KMS:
SELECT pgp_sym_encrypt(data, $1::text);   -- chave vem de KMS em runtime, não hardcoded
SELECT pgp_sym_decrypt(encrypted, $1::text);
```

`pgp_sym_encrypt` requer chave de runtime — **nunca** em função SQL hardcoded.

## Auditoria (build em nível SQL)

```sql
CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  txid bigint NOT NULL,
  table_name text NOT NULL,
  row_id uuid,             -- gen_random_uuid()
  action text NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  changed_by text NOT NULL DEFAULT current_user,
  changed_at timestamptz NOT NULL DEFAULT now(),
  diff jsonb
);

CREATE OR REPLACE FUNCTION audit_changes()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO audit_log (table_name, row_id, action, diff)
  VALUES (
    TG_TABLE_NAME,
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    CASE WHEN TG_OP = 'DELETE'
         THEN to_jsonb(OLD)
         ELSE (SELECT jsonb_object_agg(k, v) FROM jsonb_each(to_jsonb(NEW)) WHERE v IS DISTINCT FROM to_jsonb(OLD)->k)
    END
  );
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER audit_orders
  AFTER INSERT OR UPDATE OR DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION audit_changes();
```

- Tabela de auditoria com **RLS disabled** ou só role admin.
- Use `pgaudit` (extensão) quando disponível — captura mais discreto que trigger manual.

## Backup e PITR

- `archive_mode = on`; `archive_command = 'test ! -f /backup/%f && cp %p /backup/%f'`
- Retenção WAL ≥ tempo de recuperação objetivo.
- Restore PITR testado quarterly.
- Snapshot de disco + WAL archive = ponto consistente.

## Monitoramento

- `pg_stat_statements`: top queries por chamada/tempo.
- `pg_stat_activity`: long-running sessions, locks.
- `pg_locks` join: detecção de deadlock/block.
- Métricas expostas via `postgres_exporter` (Prometheus).

## Não faça

- `ALTER USER postgres PASSWORD '...';` em claro no migration.
- Permissão de superuser para role de app.
- `CREATE DATABASE` em migration versionada — script separado de provisionamento.
- Trigger que faz `SELECT * FROM same_table` — recursão.
- `VACUUM FULL` em horário prod (`ACCESS EXCLUSIVE` em toda tabela).
- Sequence sem cache — produção levada por overhead.
- `NOT NULL` adicionado em um passo em tabela grande — backfill primeiro.