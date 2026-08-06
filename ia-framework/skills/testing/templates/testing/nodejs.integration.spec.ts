import { describe, it, expect, beforeEach } from 'vitest';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { buildApp } from '<src path>/app';
import { runMigrations } from '<src path>/lib/db';

describe('POST /api/v1/orders (integration)', () => {
  let container: Awaited<ReturnType<PostgreSqlContainer['start']>>;
  let pool: Pool;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    pool = new Pool({ connectionString: container.getConnectionUri() });
    await runMigrations(pool);
    app = buildApp({ pool });
  });

  it('cria pedido válido → 201', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/orders',
      payload: { externalRef: 'PO-1', status: 'open', customerId: 'c1' },
      headers: { authorization: 'Bearer <mock jwt>' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.externalRef).toBe('PO-1');
  });

  it('conflict para external_ref duplicado → 409', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/orders', payload: { externalRef: 'PO-1' } });
    const res = await app.inject({ method: 'POST', url: '/api/v1/orders', payload: { externalRef: 'PO-1' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('conflict');
  });

  // cleanup: afterAll stop container
});