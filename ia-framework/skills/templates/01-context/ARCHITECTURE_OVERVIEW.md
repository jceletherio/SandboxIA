---
title: Visão de Arquitetura
stack: multi
updated: 2026-08-05
kpis: { health: green }
---

# Visão de Arquitetura

> Diagrama em palavras. O leitor deve saber "onde está X" depois de ler este arquivo.

## Camadas (padrão por stack)

```
[ Angular SPA ]  ──HTTPS/JWT──▶  [ Backend REST ]  ──SQL/pool──▶  [ PostgreSQL ]
 frontend/                          backend/{nodejs|spring|go}/       BD/
```

Cada backend expõe contratos versionados (`/api/v1/...`). Frontend nunca acessa BD direto.

## Responsabilidades

- **Angular** — UI, validação de input (zenity), estado de loading/erro/vazio, lazy routes.
  Sem regra de negócioAutoritativa — só cache local.
- **Backend** — regra de negócioAutoritativa, orquestração de transação, autorização.
- **Postgres** — integridade de dados (FK, CHECK, UNIQUE), RLS para isolamento de tenant,
  índices para hot path, particionamento para escala.

## Fluxo request → response (representativo)

1. Angular usa `httpResource()`/`HttpClient` com `withFetch` e `provideHttpClient`.
2. Backend valida (Bean Validation/Zod/`go-playground/validator`), autentica (JWT), aplica
   regras de domínio, abre transação, persiste.
3. Postgres executa sob RLS; pool gerenciado por `pgbouncer`/HikariCP/`pgxpool`.

## Pontos de atenção

- Virtual threads (spring) e event loop (nodejs/go) não bloqueiam em IO síncrono de BD.
- Comando SQL sem `WHERE` em tabela grande é block automático em review.
- `[ ] <preencher com armadilha conhecida do projeto durante o bootstrap>`.

## Limites declarados

- Latência-alvo p95: <preencher>
- Volume de dados previsto: <preencher>
- Concorrência esperada: <preencher>