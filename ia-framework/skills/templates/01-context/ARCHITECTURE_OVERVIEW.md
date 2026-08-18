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
[ Frontend SPA ]  ──HTTPS/JWT──▶  [ Backend REST ]  ──SQL/pool──▶  [ PostgreSQL ]
 src/frontend/ (Angular)  OU  src/react/ (React)          src/backend/{nodejs|spring|go}/       src/BD/
```

Cada backend expõe contratos versionados (`/api/v1/...`). Frontend nunca acessa BD direto.

## Responsabilidades

- **Frontend** — UI, validação de input (zenity), estado de loading/erro/vazio, lazy routes
  (Angular `httpResource`/React TanStack Query). Sem regra de negócioAutoritativa — só
  cache local.
- **Backend** — regra de negócioAutoritativa, orquestração de transação, autorização.
- **Postgres** — integridade de dados (FK, CHECK, UNIQUE), RLS para isolamento de tenant,
  índices para hot path, particionamento para escala.

## Fluxo request → response (representativo)

1. Frontend (Angular `httpResource`/`HttpClient`, ou React `useQuery` via `core/api/`) chama
   a API com Bearer JWT.
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