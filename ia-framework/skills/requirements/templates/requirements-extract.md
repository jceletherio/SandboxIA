---
title: Requisitos extraídos
source: <caminho-relativo-do-arquivo-fonte>
extracted: 2026-08-05
hash: sha256:<digest-do-arquivo>
kpis: { health: green }
---

# Requisitos extraídos

> Preenchido pelo agente `requirements-reader` a partir de `source`. Critério de escrita
> em `skills/shared/doc-structure.md`. Não edita para resolver ambiguidade — lacuna em
> `Lacunas encontradas`.

## Visão do produto

<1 parágrafo + 3-5 bullets — Só o que está no documento fonte>

## Epics / Features

- **EPIC-01 — <nome>** (fonte: §<seção>)
  - Feature F-01: <descrição>
  - Feature F-02: <descrição>

## Histórias de usuário

- **US-NNN — <título>** (fonte: §<seção>)
  - **Como** <papel>,
  - **Quero** <ação>,
  - **Para** <valor>.
  - **Critérios de aceite:**
    1. <critério>
    2. <critério>

## Requisitos funcionais (RF)

| RF-ID | Descrição | Prioridade | Fonte |
| ----- | --------- | ---------- | ----- |
| RF-NN | <descrição> | alta\|media\|baixa | §<seção> |

## Requisitos não funcionais (RNF)

| RNF-ID | Descrição | Categoria | Métrica | Fonte |
| ------ | --------- | --------- | ------- | ----- |
| RNF-NN | <descrição> | performance\|seguranca\|... | <métrica> | §<seção> |

## Restrições

- **Tecnológicas:** <lista> (fonte: §<seção>)
- **Negócio:** <lista> (fonte: §<seção>)
- **Compliance:** <lista> (fonte: §<seção>)

## Premissas

- Premissa: <o que assumimos e por quê> (fonte inferida: §<seção>)

## Lacunas encontradas

- [AMBIGUO] <trecho> — §<seção>
- [CONFLITO] <descrição do conflito> — §§<seções>
- [AUSENTE] <informação esperada mas não presente>

## Glossário

- **<termo>:** <definição> (fonte: §<seção>)