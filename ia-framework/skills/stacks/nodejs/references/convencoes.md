# Node.js 22+ — Convenções

## Nomeação

- **Route file**: `orders.routes.ts` — default export `defineRoutes` ou function export `defineOrdersRoutes`.
- **Controller**: `OrdersController` (classe NestJS) ou `orders.controller.ts` com handlers function-exported.
- **Service**: `OrdersService` classe, métodos async,`= retorna Vm`/throw.
- **Repository**: `OrdersRepository` classe, métodos async, SQL puro.
- **Dto**: `CreateOrderDto`, `OrderVm`, `OrderRow` (DB), `OrderVm` (cliente), `OrderSnapshot` (domínio).
- **Plugin**: `authPlugin`, `tenantContextPlugin` (camelCase, sufixo Plugin).
- **Erro**: `BadRequestError`, `ConflictError`, `NotFoundError`, `UnauthorizedError`, `ForbiddenError`.

## Imports (ESM) — sufixo `.js`

TypeScript ESM exige `.js` no import specifier mesmo com `.ts` no disco:

```ts
import { OrdersService } from './orders.service.js';
```

Aliases `#` configurado no `package.json` `imports`:

```json
{ "imports": { "#*": "./src/*" } }
```

## Estrutura de handler

```ts
export async function createOrderHandler(req: FastifyRequest, reply: FastifyReply) {
  const dto = req.body as CreateOrderDto;
  const ctx = req.tenantContext;
  const result = await ordersService.create(dto, ctx, req.log);
  return reply.code(201).send(result);
}
```

Handler ≤ 10 linhas. Sem lógica de domínio, sem SQL, sem `try/catch`.

## Erros

- Service lança `AppError` subclasses. Handler não captura.
- Mensagem client-safe; detalhe técnico fica no `cause` do log interno.
- Padronize corpo de erro em TODO endpoint:
  ```json
  { "error": { "code": "conflict", "message": "external_ref já existe", "details": { "field": "external_ref" } } }
  ```

## Async / await

- Toda fn do handler é `async`. `Express` exige `asyncHandler` wrapper:
  ```ts
  export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  ```
- Não misture callback-style em código novo.

## Logger

- `pino`. Não `winston` (pesado) ou `console.log`.
- `req.log` injeta correlationId/tenantId automaticamente (via ALS plugin).
- Níveis: `trace`, `debug`, `info`, `warn`, `error`, `fatal`. Em prod `info`.
- Log de erro inclui `err` (objeto Error serializado pelo pino).

## Imports

```ts
import { FastifyRequest, FastifyReply } from 'fastify';
import { pool } from '#lib/db.js';
import { OrdersService } from './orders.service.js';
```

## Variáveis de ambiente

- Schema `zod` em `config/env.ts`. Parseado uma vez no boot.
- Sem fallback para secrets: deve falhar em prod se ausente.
- Nome: `DATABASE_URL`, `REDIS_URL`, `JWT_PRIVATE`, `JWT_PUBLIC`, `CORS_ORIGINS`, `PORT`,
  `NODE_ENV`, `LOG_LEVEL`.

## Testes

- **Vitest** recomendado (ESM nativo, watch rápido). Jest OK em legados.
- Nome: `*.spec.ts` ou `*.test.ts` ao lado do módulo.
- Integration tests com `app.inject()` (Fastify) ou `supertest` (Express).
- DB real via Testcontainers (Postgres) ou `pg-mem` para unit de repository com fixture.
- Não mocke o que não é seu (BD, Redis, HTTP externo) em testes de integração.

## Commit

`shared/git-conventions.md`. Scopes: `orders`, `auth`, `users`, `rate-limit`,
`observability`, `db`. Exemplo:

```
feat(orders): adiciona endpoint POST /orders com validação zod e tx no service
```

## Hardlines

- **Não reinicie** dev/watch se já está de pé (porta 3000/similar).
- **Não** `npm install` em trilha SDD — dependência nova é decisão de arquitetura, vira
  pergunta antes.
- **Não** rotear `console.log` em produção. Use logger.
- **Não** commit `.env`/`*.local.*`/`node_modules`.