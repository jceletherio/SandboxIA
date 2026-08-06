---
title: Plano de desenvolvimento
updated: 2026-08-05
kpis: { health: green }
---

# Plano de desenvolvimento — Petshop PetLover

> Gerado por `/plan-from-requirements requisito.md` a partir de
> `01-context/requirements.md + screens/S-001-orders-list.md`. Ordem é sugestão baseada em
> dependências técnicas.

## Trilhas em ordem sugerida

| NN | slug | stack | depende de | features atendidas | RFs/RNFs cobertos |
| -- | ---- | ----- | ---------- | ------------------ | ----------------- |
| 001 | products-schema | postgres | — | F-01 (parte BD) | RF-01, RF-02, RNF-05 |
| 002 | products-api | spring | 001 | F-01, F-02 | RF-01, RF-02, RNF-01, RNF-03 |
| 003 | orders-schema | postgres | — | F-03 (parte BD) | RF-03, RF-04, RF-06, RNF-05 |
| 004 | orders-api | spring | 003 | F-03 | RF-03, RF-04, RF-05, RNF-02, RNF-03 |
| 005 | orders-ui | angular | 002, 004 | UI S-001 lista pedidos | RF-01, RF-03; RNF-01 (lado UI) |
| 006 | products-ui | angular | 002 | UI catálogo + busca | RF-01, RF-02 |

## Racional da ordem

- **001/003 primeiro** (schema DB) — backend quebra sem tabelas.
- **002/004 depois** (API Spring) — frontend precisa de contrato publicado.
- **005/006 por último** (UI Angular) — consome contratos; `005` referencia tela `S-001`.

## Premissas assumidas em plano

- Premissa: só haverá um tenant por instalação (lacuna em `requirements.md`).
- Premissa: prazo de entrega fixo de 7 dias úteis (lacuna em US-003).
- Premissa: rate-limit default 600 req/min/tenant (lacuna em RNF).

## Lacunas não cobertas

- [AMBIGUO] US-003 prazo de entrega — assumido 7 dias; rever antes do release.
- [AUSENTE] RNF rate-limit — usar default do template (`@fastify/rate-limit` 600/min).

## Próximo passo

Para cada trilha aberta, execute o SDD:

```
/sdd --stack=postgres feature 001 products-schema
/sdd --stack=spring   feature 002 products-api
...
```

Após todas as trilhas:

```
/tests-release --stack=all
/generate-architecture --stack=all
/contract-check
```