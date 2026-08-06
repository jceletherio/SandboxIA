# Node.js — Testing

## Stack atual

- **Node.js 22+ (ESM)**. Imports com `.js`. pino para logs. Zod para schemas.

## Níveis × Frameworks

| Nível | Framework | Notas |
| ----- | --------- | ----- |
| Unitário | Vitest (preferido) ou Jest | `environment: 'node'`, `globals: true`. Testa mappers, validators Zod, services com `repo` mockado. |
| Funcional | Fastify `app.inject()` ou `supertest` (Express) | Sem BD real — fake do repo. Verifica contrato HTTP. |
| Integração | Testcontainers + `pg` real | Run migrations; `app.inject` com store real; verifica RLS, FKs, unique. |
| Sistema | `curl` smoke ou Playwright API request context | Backend up completo; checa `/health`, contrato público, 401 sem token. |
| Aceitação | Playwright API request context | Cada critério de aceite vira um teste HTTP. |
| E2E | Playwright (se há frontend) | Combina UI (Angular) + API no mesmo teste. |

## Setup do projeto

`test-setup` instalará:
- `vitest`, `@vitest/coverage-v8`
- `supertest` (se Express legado; Fastify tem `app.inject` nativo)
- `@testcontainers/postgresql`
- `@playwright/test` (root monorepo `e2e/`)

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node', globals: true,
    coverage: { provider: 'v8', reporter: ['text'] },
  },
});
```

## Unitário — boilerplate

```ts
import { describe, it, expect } from 'vitest';
import { mapOrderToVm } from './orders.mapper';

describe('mapOrderToVm', () => {
  it('mapeia snake_case → camelCase', () => {
    expect(mapOrderToVm({ external_ref: 'PO-1', status: 'open', tenant_id: 't1' }))
      .toEqual({ externalRef: 'PO-1', status: 'open', tenantId: 't1' });
  });
});
```

## Funcional — Fastify inject (sem BD)

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { buildApp } from './app';
import { MockOrdersRepository } from './orders.repository.mock';

describe('POST /api/v1/orders (functional)', () => {
  let app;
  beforeAll(async () => {
    app = buildApp({ ordersRepo: new MockOrdersRepository() });
    await app.ready();
  });

  it('cria pedido válido → 201', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/v1/orders',
      payload: { externalRef: 'PO-1', status: 'open', customerId: 'c1' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('invalid body → 400 bad_request', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/orders', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('bad_request');
  });
});
```

## Integração — Testcontainers + pg

```ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';

let container, pool;
beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await runMigrations(pool);
});
afterAll(async () => { await pool.end(); await container.stop(); });

test('POST com external_ref duplicado → 409', async () => {
  await app.inject({ method: 'POST', url: '/api/v1/orders', payload: { externalRef: 'PO-DUP' } });
  const res = await app.inject({ method: 'POST', url: '/api/v1/orders', payload: { externalRef: 'PO-DUP' } });
  expect(res.statusCode).toBe(409);
});
```

## Bug-fix regressão

Reproduza no nível adequado:
- Service logic (zod parse, mapper) → unit.
- Handler + service (status code, error shape) → functional.
- Service + DB (tx, RLS, conflict) → integration.

Após fix:
- Rode `npx vitest run path/to/regression.test.ts` — deve passar green.
- Correção entra no mesmo commit que o teste.

## Não faça

- Não mocke modules com `vi.mock` por caminho em novo teste — prefira injeção de fakes
  (constructor/`buildApp` options). `vi.mock` cria acoplamento implícito que quebra com
  refactor.
- Não rode Testcontainers em `npm test` por default — segmente por tag (`integration.test.ts`)
  e gating por env `RUN_INTEGRATION=1`.
- Não use `setTimeout` para wait em testes — `await` na promise do `app.inject`.