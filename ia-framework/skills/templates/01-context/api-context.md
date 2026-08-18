---
title: Contratos de API (contexto)
updated: 2026-08-05
kpis: { health: green }
---

# Contratos de API

Apenas contratos **públicos** consumidos por outra stack/serviço. Para detalhe, leia o
código citado. Atualize este arquivo quando um contrato mudar assinatura/tipo.

## Convenção de erro

Todo endpoint padroniza corpo de erro:

```json
{ "error": { "code": "<slug>", "message": "<humano>", "details": {} } }
```

Códigos: `bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`,
`rate_limited`, `internal`.

## Endpoints

### `<stack>` — `<METHOD> /api/v1/<path>`

- **Request** — `<shape>` (referência ao DTO/schema).
- **Response 2xx** — `<shape>`.
- **Erros** — `<code> quando <condição>`.
- Ref.: `src/backend/<stack>/<arquivo:linha>`.

## Autenticação

- JWT (RS256) com `kid` rotacional. Header `Authorization: Bearer <token>`.
- Claims: `sub`, `tenant_id`, `scopes[]`, `exp` ≤ 1h, `iat`.
- Refresh: cookie HttpOnly Secure SameSite=Strict, ≤ 7 dias, com rotação.

## Rate-limit

- Padrão: 100 req/min/IP anônimo, 600 req/min/tenant autenticado.
- Header `Retry-After` em `429`.