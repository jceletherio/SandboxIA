---
title: Indice de memoria do projeto
updated: 2026-08-05
kpis: { health: green }
---

# Indice de memoria (<500 tokens)

> Gerado por `extract-index.ps1`. Cache, nao source of truth. Consulte antes
> de mergulhar em arquivos. Desatualizado? Use `grep -rn` ou dispare
> `context-curator` em modo update.

## KPIs

- trilhas: 0 abertas | 0 bloqueadas | 3 prontas (total: 3)
- ADRs propostos: 0

## Mapa

### 01-context (memoria viva)

- `project_sdd/01-context/plan.md` - Plano de desenvolvimento â€” Petshop PetLover
  - secoes: Trilhas em ordem sugerida - Racional da ordem - Premissas assumidas em plano - Lacunas nÃ£o cobertas - PrÃ³ximo passo
- `project_sdd/01-context/requirements.md` - Requisitos extraÃ­dos â€” Petshop PetLover
  - secoes: VisÃ£o do produto - Epics / Features - HistÃ³rias de usuÃ¡rio - Requisitos funcionais (RF) - Requisitos nÃ£o funcionais (RNF) - RestriÃ§Ãµes - Premissas - Lacunas encontradas

### 02-specs (trilhas SDD)

- `project_sdd/02-specs/001-products-schema/spec.md` - 
  - secoes: Comportamento alvo - Contratos tocados - Tarefas - Fora de escopo - Premissas assumidas - Notas de review
- `project_sdd/02-specs/002-products-api/spec.md` - 
  - secoes: Comportamento alvo - Contratos tocados - Tarefas - Fora de escopo - Premissas assumidas - Notas de review
- `project_sdd/02-specs/003-orders-ui/spec.md` - 
  - secoes: Comportamento alvo - Contratos tocados - Tarefas - Fora de escopo - Premissas assumidas - Notas de review

### docs/architecture (snapshot per-release)

- `docs/architecture/overview.md` - Arquitetura â€” VisÃ£o Geral â€” Petshop PetLover
  - secoes: Fluxo request â†’ response (crÃ­tico) - AutenticaÃ§Ã£o - Stacks ativas - ADRs relevantes - Pontos de atenÃ§Ã£o - NÃ£o metas

### docs/testing (planos de teste)

- `docs/testing/test-plan-frontend-angular.md` - Plano de testes â€” Frontend Angular â€” Petshop PetLover
  - secoes: NÃ­veis cobertos - CenÃ¡rios de aceitaÃ§Ã£o (cada CA da spec â†’ cenÃ¡rio) - Comandos de execuÃ§Ã£o - Trace artefatos - PrÃ³ximas progressÃµes (nÃ£o desta release)

## Nao cobre

- Codigo de producao - use `grep -rn` em `frontend/`, `backend/`, `BD/`.
- Estado de git - use `git status`/`git log`.
