---
name: nodejs
description: Conduz o fluxo SDD Enxuto para backend Node.js 22+ (ESM, Fastify/Express5/NestJS). Event loop, AsyncLocalStorage, validação Zod, graceful shutdown, JWT com rotação, OWASP. Gatilhos: "API NodeJS", "endpoint Node", "rota Fastify", "service Node", "/sdd nodejs".
---

# Node.js 22+ — fluxo SDD Enxuto

Spec antes do código, mínimo de cerimônia que evita retrabalho. Fases gerais em
`skills/shared/flow.md`; detalhes específicos em `references/`.

| Fase | Produz | Fecha quando |
| ---- | ------ | ------------ |
| 1. Contexto | mapa de rotas/handlers/services/repos afetados | escopo claro de camadas tocadas |
| 2. Spec + Tarefas | `02-specs/{NNN}-{slug}/spec.md` com contratos HTTP | tarefas executáveis sem adivinhar |
| 3. Implementação | código ESM + validação + observabilidade | `tsc`/`vitest`/suíte e typecheck limpos |
| 4. Review + Testes | verdict `ready \| blocked` com `arquivo:linha` | comportamento alvo bate com código |
| 5. Report | decisões não óbvias + achados fora de escopo | próxima sessão retoma |

## Princípios Node.js

1. **ESM first.** `"type": "module"` no `package.json`. Sem `require()` em código novo
   (só em scripts de build/administrativos).
2. **Event loop intocado.** Nunca bloqueie com CPU-bound síncrono, JSON.parse de payload
   grande, `crypto.pbkdf2Sync`, `fs.readFileSync` em hot path. Use streams, `AbortController`,
   worker threads para tarefas CPU.
3. **AsyncLocalStorage para tracing.** `requestId`, `tenantId` propagados sem parâmetro.
   logger e tracing lêem do ALS — não acoplar handlers.
4. **Validação na borda.** Toda request tem schema (Zod, @fastify/zod, @nestjs/zod).
   Erro = 400 estruturado `{ error: { code, message, details } }`.
5. **Error middleware única.** Fastify `setErrorHandler`, Express/Errorhandler Express5
   (`asyncHandler` wrapper para evitar rejeição não capturada), NestJS `ExceptionFilter`
   global. Serviços lançam, o handler formata.
6. **Logout estruturado em JSON.** `pino` para produção — log level env, correlationId do
   ALS, sem console.log solto.
7. **Graceful shutdown.** `SIGTERM`/`SIGINT`: para de aceitar conexões, draineia filas,
   fecha pool de BD com timeout. `server.close()` + `await pool.end()`.
8. **Secretos fora do repo.** Variável de ambiente, `process.env` validada em runtime
   (`zod` env schema), Vault/SSM/KMS em prod. Nunca `application.yml`/`.env` commitado.
9. **Transação no service.** Repository não conhece tx; service abre `tx` via `pool.connect()`
   e repassa `client`. Sem `BEGIN/COMMIT` manual solto.
10. **Não confie no cliente.** Autorização decide no backend. JWT expira curto (≤ 15 min);
    refresh curto/longo rotacional; rotação de `kid`.

## Setup (primeira vez)

1. `SDD_ROOT` (default `./project_sdd`). Árvore ausente →
   `pwsh skills/scaffold.ps1 init <SDD_ROOT>`.
2. `01-context/` vazio → rode `/sdd-context`.
3. Trilha: `pwsh skills/scaffold.ps1 new feature <slug>`.

## As 5 fases (específicas NodeJS)

**1. Contexto.** Localize routes, handlers (controllers), services, repositories,
middlewares, plugins. Contratos: schema de request/response, status code esperado,
comportamento de erro. Ambiguidades em bloco: quem valida? Tx no service ou handler?
Idempotência? Rate-limit por rota?

**2. Spec + Tarefas.** Quatro seções (ver `flow.md`). Contratos tocados → endpoint
`METHOD /api/v1/<path>` com tipos TS + caminho de erro. Tarefas por camada:
1) schema validation → 2) handler → 3) service (+ tx) → 4) repo → 5) integration test.

**3. Implementação.** Padrões em `references/arquitetura.md`. Não reinicie o dev server —
TS watch já roda. Não adicione `console.log` (use `req.log.info` do pino). Um commit por
task. Respeite `references/seguranca.md` em cada handler.

**4. Review + Testes.** Delegue ao `reviewer`. Suíte existente roda (Vitest/Jest/`node --test`).
Teste novo só para lógica pura (validators, mappers, service com mock de repo).
Integration tests com `supertest`/fastify inject não são novos em trilha — só bug-fix
quando o bug é sintoma de regressão de contrato.

**5. Report.** Decisões: schema-per-route vs compartilhado? tx em service ou
repository? rate-limit novo? Pgbouncer transaction vs session pool? Mensagens de erro
normalizadas? Armadilhas: ordem de middleware, env var obrigatória nova, fontes de
async context.

## Regras duras

- **Nunca** `eval`, `Function`, `vm.runInNewContext` em runtime. Verificação estática +
  `gosec`-equivalent (`eslint-plugin-security`).
- **Nunca** f-string/template user input em SQL — `pg` parameterized queries, ## placeholders.
- **Nunca** `setTimeout`/`setInterval` long lifespan sem `AbortController` e shutdown hook.
- **Nunca** `process.env.SECRET` direto — schema `zod` que valida e tipa no boot;
  missing em prod = throw.
- **Nunca** blocks event loop em route hot path.
- **Sem `any`**. `unknown` + narrow, ou tipo discriminado.
- **Sem output dumping** — `pino` no início; trocar para `console.log = krit`.

## Limitação (declare no recibo)

Sem browser/cliente. Não há runtime vivo na sessão SDD; review é estático (código,
tipos, testes, contratos). Não dispara integração real com serviços externos.