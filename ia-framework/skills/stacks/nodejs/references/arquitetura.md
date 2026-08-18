# Node.js 22+ — Padrões de Arquitetura

## Estrutura de pastas (Fastify参考; NestJS similar)

```
src/backend/nodejs/
  src/
    app.ts                          bootstrap: createServer, plugins, router, shutdown hooks
    server.ts                       buildApp() separado p/ teste
    config/
      env.ts                        envSchema (zod) validada no boot
    plugins/
      auth.ts                       verifyJWT plugin (preHandler)
      tenant-context.ts              ALS: set/get tenantId, requestId
      error-handler.ts              setErrorHandler global
      rate-limit.ts                 @fastify/rate-limit com redis store
    http/
      <dominio>/
        <dominio>.routes.ts         defineRotas({ method, url, schema, handler })
        <dominio>.controller.ts      handler thin → service
        <dominio>.service.ts         regra de negócio, abre tx
        <dominio>.repository.ts      queries SQL (pg parameterized)
        <dominio>.dto.ts             schemas zod request/response + tipos
    lib/
      db.ts                          pg.PoolFactory, sql helper
      logger.ts                      pino instance + ALS bindings
      result.ts                      Result<T,E> tipo (não throw em service)
      errors.ts                     AppError subclasses (BadInput, Unauthorized...
    test/
      unit/                          pure logic
      integration/                   supertest/inject
  package.json                      "type": "module", scripts: dev, build, test, lint
  tsconfig.json                     strict, ESNext, moduleResolution bundler
  vitest.config.ts
```

## Bootstrap de server (Fastify)

```ts
import Fastify, { FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { tenantContextPlugin } from './plugins/tenant-context.js';
import { authPlugin } from './plugins/auth.js';
import { errorHandler } from './plugins/error-handler.js';
import { ordersRoutes } from './http/orders/orders.routes.js';

export function buildApp() {
  const app = Fastify({
    logger,
    trustProxy: true,
    bodyLimit: 1_048_576,
    ajv: { customOptions: { coerceTypes: false } }, // zod cuida
  });
  app.register(helmet);
  app.register(cors, { origin: env.CORS_ORIGINS });
  app.register(rateLimit, { max: 100, timeWindow: '1 minute', redis: redisStore });
  app.register(tenantContextPlugin);
  app.register(authPlugin);
  app.register(ordersRoutes, { prefix: '/api/v1' });
  app.setErrorHandler(errorHandler);
  return app;
}
```

`buildApp()` separado de `app.listen()` para teste com `app.inject()`.

## Camada — handler thin

```ts
// http/orders/orders.controller.ts
import { FastifyRequest, FastifyReply } from 'fastify';
import { CreateOrderDto } from './orders.dto.js';
import { OrdersService } from './orders.service.js';

export async function createOrderHandler(req: FastifyRequest, reply: FastifyReply) {
  const dto = req.body as CreateOrderDto;           // já validado pelo schema da rota
  const tenantId = req.tenantContext.tenantId;      // do plugin ALS
  const result = await new OrdersService().create(dto, tenantId, req.log);
  return reply.code(201).send(result);
}
```

Handler não conhece SQL nem tx. Só traduz DTO → service → resposta.

## Camada — service com transação

```ts
// http/orders/orders.service.ts
import { pool } from '../../lib/db.js';
import { OrderVm, CreateOrderDto, orderToVm } from './orders.dto.js';
import { OrdersRepository } from './orders.repository.js';
import { AppError, ConflictError } from '../../lib/errors.js';

export class OrdersService {
  async create(dto: CreateOrderDto, tenantId: string, log: Logger): Promise<OrderVm> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const repo = new OrdersRepository(client);
      const existing = await repo.findByExternalRef(dto.externalRef, tenantId);
      if (existing) throw new ConflictError('external_ref', dto.externalRef);
      const order = await repo.insert(dto, tenantId);
      await client.query('COMMIT');
      return orderToVm(order);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
}
```

`try/catch/finally` é a única ceremony. Repository só recebe `client` — não decide tx.

## Repository — parameterized queries

```ts
export class OrdersRepository {
  constructor(private client: PoolClient) {}

  async insert(dto: CreateOrderDto, tenantId: string): Promise<OrderRow> {
    const { rows } = await this.client.query<OrderRow>(
      `INSERT INTO orders (external_ref, status, tenant_id, created_at)
       VALUES ($1, $2, $3, now())
       RETURNING *`,
      [dto.externalRef, dto.status, tenantId],
    );
    return rows[0];
  }
}
```

**Nunca** template string com `${}` interpolando input. Sem ORM dinâmico findById genérico
que recebe coluna arbitrária — whitelista colunas permitidas.

## Plugin/ALS para contexto de request

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
const als = new AsyncLocalStorage<{ requestId: string; tenantId: string }>();

app.decorateRequest('tenantContext', { getter: () => als.getStore() });

app.addHook('onRequest', async (req) => {
  const requestId = req.id;
  const tenantId = extractTenantFromJwt(req);
  als.enterWith({ requestId, tenantId });
  req.log = req.log.child({ requestId, tenantId });
});
```

Serviços pegam contexto via helper `getContext()`, sem parametro acoplado.

## Erros e handler

```ts
export class AppError extends Error { constructor(public code: string, public status: number, message: string, public details?: unknown) { super(message); } }
export class BadRequestError extends AppError { constructor(field: string, val: unknown) { super('bad_request', 400, `Invalid ${field}`, { field, value: val }); } }
// ConflictError -> 409, UnauthorizedError -> 401, ForbiddenError -> 403

export function errorHandler(err: Error, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof AppError) {
    return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
  }
  // zod validation virou AppError pelo schema preHandler — senão:
  req.log.error({ err }, 'unhandled');
  return reply.code(500).send({ error: { code: 'internal', message: 'Unexpected error' } });
}
```

## Graceful shutdown

```ts
const app = buildApp();
await app.listen({ port: env.PORT, host: '0.0.0.0' });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();           // para de aceitar conexões
  await pool.end();            // fecha pool de BD
  app.log.info('bye');
  process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
```

## Não faça

- `new Logger()` se logger Alpine com ALS existe — `req.log` ou `app.log`.
- Pool por request — pool é singleton (`lib/db.ts`).
- `async` no middleware sem retorno promessa explicito (Express precisa `asyncHandler`).
- Repository que conhece regra de negócioAutoritativa — só SQL.
- Service que conhece HTTP (`req`/`res`). Recebe DTO e contexto.