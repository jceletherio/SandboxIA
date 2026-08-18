---
title: Plano do Protótipo — <nome do produto>
prototype_id: PROTOTYPE-<seq>
source: project_sdd/01-context/requirements.md
updated: <data>
kpis: { health: green }
---

# Plano do Protótipo — <nome do produto>

> Gerado por `prototype-planner` na F1 do `/prototype-screens`. Divisão em partes coesas
> (P-NNN) a partir dos requisitos. Fonte de verdade: `01-context/requirements.md`.

## Escopo

- Requisitos cobertos: <RF-ID list, US-ID list>
- Fora de escopo do protótipo: <fluxos que não serão prototipados e por quê>

## Partes (P-NNN)

| Parte | Slug | Telas | RF/US cobertos | Depende de | Prioridade |
| --- | --- | --- | --- | --- | --- |
| P-001 | <slug> | <tela(s) e fluxo> | RF-xx, US-xx | — | Alta |
| P-002 | <slug> | <tela(s) e fluxo> | RF-xx, US-xx | P-001 | Média |

## Racional da ordem

<por que P-001 antes de P-002 — dependências de navegação/dados>

## Lacunas [AMBIGUO]

- <lacuna que virou pergunta ou premissa assumida no design>

## Próximo passo

1. Para cada parte: `prototype-designer` → `01-context/prototype/designs/P-NNN-<slug>.md`.
2. Implementar via `prototype-builder` em `src/frontend/src/app/prototype/`.
3. Revisar completude via `prototype-reviewer`.
