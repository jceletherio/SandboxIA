---
title: Mapa do Projeto
stack: multi
updated: 2026-08-05
kpis: { health: green }
---

# Mapa do Projeto

## Stacks ativas (do `ia-framework/STACK.md`)

- Frontend: angular — raiz `frontend/`
- Backend: nodejs — raiz `backend/nodejs/`
- Backend: spring — raiz `backend/spring/`
- Backend: go — raiz `backend/go/`
- BD: postgres — raiz `BD/`

## Diretórios-chave e donos

| Diretório | Stack | Responsabilidade |
| --------- | ----- | ---------------- |
| `frontend/src/app/<feature>/` | angular | feature folders — cada uma autocontida |
| `backend/nodejs/src/<dominio>/` | nodejs | camadas: routes, services, repos |
| `backend/spring/src/main/java/<pkg>/` | spring | controller/service/repository |
| `backend/go/cmd/`, `internal/` | go | entrypoints em cmd, domínio em internal |
| `BD/sql/{schema,migrations,rls,indexes}/` | postgres | SQL versionado e organizado por propósito |

## Onde mexer para…

- Adicionar rota HTTP nova → `<stack>`: pasta de rotas/handlers/controllers correspondente.
- Mudar schema → `BD/sql/migrations/` (Flyway versionado) + ajustar consumers.
- Nova policy RLS → `BD/sql/rls/tenant_policies.sql`.
- Novo teste e2e Angular → `frontend/e2e/` (Playwright), não dentro de feature.
- Logging/observabilidade → pasta de middleware/interceptor da stack.