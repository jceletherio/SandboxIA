# Estrutura dos docs `docs/architecture/<stack>.md`

 Cada doc segue as seções abaixo (não alterar ordem — facilita diff e busca):

## 1. Front-matter

```yaml
---
title: Arquitetura — <Stack>
stack: angular | react | nodejs | spring | go | postgres
updated: 2026-08-05
kpis: { health: green }
---
```

`health`: `green` < 30 dias, `yellow` < 90, `red` além — re-rodar `/generate-architecture`.

## 2. Visão de camada (1 parágrafo)

Onde esta stack se encaixa no fluxo. Quem consome (cidadão upstream) e o que produz
(downstream).

## 3. Componentes (com diagrama Mermaid)

Diagrama `flowchart` Mermaid mostrando módulos/chaves internos e dependências. Referencie
caminhos reais do repo (`src/backend/spring/src/main/java/.../`).

## 4. Decisões não óbvias (com razão)

Lista ordenada. Cada item: **decisão** + **razão** + **alternativa descartada**. Mapeada a
ADR quando houver (`03-decisions/ADR-NNN.md`).

## 5. Contratos publicados

Para backend/front: endpoints públicos, schemas de eventos,propriedades de options
importados/exportados. Para BD: tipos SQL exportados, podem ser consumed by app code
via geração de tipos (ex.: `sqlc`).

## 6. Mapeamento para `01-context/`

Links literais para as entradas já escritas de `api-context.md`, `constraints.md`,
`ARCHITECTURE_OVERVIEW.md` — paths relativos reais, não seções "consulte".

## 7. Não metas explicitamente

O que esta stack **não** entrega. Evita leitura errada de que X é responsabilidade dela.

## Doc Overview (`docs/architecture/overview.md`)

Sections:

1. Front-matter (`stack: multi`)
2. **Fluxo request → response** — diagrama Mermaid `flowchart LR` cruzando Angular →
   Backend → Postgres, com label de protocolo (HTTPS/JWT, SQL via pool)
3. **Autenticação e autorização** — fluxo JWT com JWKS, refresh, rate-limit
4. **Stacks ativas** — tabela com raiz, doc técnico de cada, e stack do manifesto
5. **ADRs relevantes** — linkáveis para `03-decisions/ADR-NNN.md`
6. **Pontos de atenção** — armadilhas conhecidas (pinning virtual threads, lock timeout,
   event loop)
7. **Não metas** — explicitamente "isto é documento, não é audit de conformidade"

## Forma geral

- Caminhos relativos reais sempre (estilo `grep -rn "src/frontend/src/app/..."`)
- Mermaid em blocos ` ```mermaid ... ``` `
- Sem Emojis, sem ASCII art, sem imagens binárias (não renderiza em diff)
- Reaproveita o código-fonte, não paraphrase trechos longos