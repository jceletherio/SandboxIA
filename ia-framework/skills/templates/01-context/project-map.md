---
title: Mapa do Projeto
stack: multi
updated: 2026-08-05
kpis: { health: green }
---

# Mapa do Projeto

## Stacks ativas (do `ia-framework/STACK.md`)

- Frontend: angular — raiz `src/frontend/`
- Backend: nodejs — raiz `src/backend/nodejs/`
- Backend: spring — raiz `src/backend/spring/`
- Backend: go — raiz `src/backend/go/`
- BD: postgres — raiz `src/BD/`

## Diretórios-chave e donos

| Diretório | Stack | Responsabilidade |
| --------- | ----- | ---------------- |
| `src/frontend/src/app/<feature>/` | angular | feature folders — cada uma autocontida |
| `src/backend/nodejs/src/<dominio>/` | nodejs | camadas: routes, services, repos |
| `src/backend/spring/src/main/java/<pkg>/` | spring | controller/service/repository |
| `src/backend/go/cmd/`, `internal/` | go | entrypoints em cmd, domínio em internal |
| `src/BD/sql/{schema,migrations,rls,indexes}/` | postgres | SQL versionado e organizado por propósito |

## Onde mexer para…

- Adicionar rota HTTP nova → `<stack>`: pasta de rotas/handlers/controllers correspondente.
- Mudar schema → `src/BD/sql/migrations/` (Flyway versionado) + ajustar consumers.
- Nova policy RLS → `src/BD/sql/rls/tenant_policies.sql`.
- Novo teste e2e Angular → `src/frontend/e2e/` (Playwright), não dentro de feature.
- Logging/observabilidade → pasta de middleware/interceptor da stack.