# 01-context/ — Memória do projeto

O que uma sessão futura lê para retomar sem redescobrir. Critério e forma em
`skills/shared/doc-structure.md`. **Só o que existe no código** — nada de planejado.

## Arquivos esperados

| Arquivo | Conteúdo |
| ------- | -------- |
| `project-map.md` | stack + diretórios-chave + quem é dono de quê |
| `product-vision.md` | o que o produto é, em 1 parágrafo + 3 bullets |
| `constraints.md` | restrições técnicas e de negócio que balizam decisões |
| `ARCHITECTURE_OVERVIEW.md` | camadas, dependências, fluxo request→response |
| `api-context.md` | contratos de API públicos (assinatura + caminho de erro) |

Deep-dive por módulo entra como `module-<nome>.md` quando vale — não é obrigatório.

## Front-matter (lido por ferramentas)

```yaml
---
title: <título>
stack: angular | nodejs | spring | go | postgres | multi
updated: 2026-08-05
kpis: { health: green | yellow | red }
---
```

`health` reflete o quão atual o doc está: `green` < 30 dias, `yellow` < 90, `red` além.
Updater deve reavaliar e ajustar após tocar o doc.

## Não entre aqui

- Log de mudanças — isso é `git log`.
- Roadmap e planejado.
- Detalhe de implementação recuperável lendo o código — só o porquê não óbvio.