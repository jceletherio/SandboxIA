---
title: Tela — <nome>
screen_id: S-NNN
source: req/screens/<arquivo.png>
updated: 2026-08-05
kpis: { health: green }
---

# Tela — <nome>

> Capturada por `screens-reader` via LLM vision no prompt. ID estável — referenciado
> pelas trilhas Angular no "Comportamento alvo" da spec.

## Propósito

<1 parágrafo curto>

## Layout

- **Cabeçalho** (topo): <elementos>
- **Sidebar** <lado e largura>: <elementos>
- **Conteúdo central**: <elementos>
- **Footer**: <elementos>

## Componentes esperados

- `app-<nome>` — <responsabilidade>
- `app-<nome>` — <responsabilidade>

## Paths / interações

- Clicar <X> → <ação/rota>
- Filtrar <Z> → <efeito>

## Estados loading / erro / vazio

- **Loading**: <descrição skeleton>
- **Erro**: <descrição estado>
- **Vazio**: <descrição estado com CTA>

## A11y esperada

- <requisto a11y 1>
- <requisto a11y 2>

## Dados consumidos

- `httpResource<...>('/api/v1/...')` — <endpoint>
- Referência: `01-context/api-context.md` §<seção>

## Telas relacionadas

- Anterior: `S-NNN`
- Próxima: `S-NNN`
- Modal relacionado: `S-NNN`